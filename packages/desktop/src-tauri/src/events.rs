//! Los eventos del daemon hacia la interfaz (ADR-010 §1). Lee `GET /v1/events` (SSE) por el socket y
//! reenvía al webview, como eventos de Tauri, solo un resumen: de qué tarea y de qué tipo. El token
//! y el contenido de los eventos se quedan aquí.

use crate::daemon::{connection, get, home};
use serde::Serialize;
use std::io::{BufRead, BufReader, Error, ErrorKind, Read, Write};
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::Emitter;

/// Nombre del evento de Tauri que escucha la interfaz.
pub const EVENT: &str = "daemon-event";
const TIMEOUT: Duration = Duration::from_secs(2);
/// El daemon manda un latido cada 15 s: tres sin noticias y la conexión se da por muerta.
const IDLE: Duration = Duration::from_secs(45);
const RETRY: Duration = Duration::from_secs(2);
const MAX_LINE: u64 = 1024 * 1024;
const MAX_SAFE: u64 = (1 << 53) - 1;

/// Lo que ve el webview: sin cabeceras, sin cuerpos de evento y sin texto libre del daemon.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Forwarded {
    /// Conectado: lo anterior pudo perderse, así que la interfaz recarga la lista.
    Open,
    /// Un evento de la tarea `number`; `name` es su tipo (`task.state_changed`…).
    Task { seq: u64, number: u64, name: String },
    Closed { reason: &'static str },
}

/// Cuerpo con `Transfer-Encoding: chunked`, que es como el daemon manda el SSE.
struct Chunked<R: BufRead> {
    inner: R,
    left: usize,
    done: bool,
}

impl<R: BufRead> Read for Chunked<R> {
    fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
        if self.done {
            return Ok(0);
        }
        if self.left == 0 {
            let mut size = String::new();
            if self.inner.by_ref().take(32).read_line(&mut size)? == 0 {
                return Ok(0);
            }
            let hex = size.trim().split(';').next().unwrap_or("");
            self.left = usize::from_str_radix(hex, 16)
                .ok()
                .filter(|n| *n as u64 <= MAX_LINE)
                .ok_or_else(|| Error::new(ErrorKind::InvalidData, "trozo no válido"))?;
            if self.left == 0 {
                self.done = true;
                return Ok(0);
            }
        }
        let want = out.len().min(self.left);
        let n = self.inner.read(&mut out[..want])?;
        if n == 0 {
            return Err(ErrorKind::UnexpectedEof.into());
        }
        self.left -= n;
        if self.left == 0 {
            self.inner.read_exact(&mut [0; 2])?;
        }
        Ok(n)
    }
}

/// Una línea entera (con su `\n`), de a lo sumo `MAX_LINE` bytes. `false` si la conexión se cerró.
fn line<R: BufRead>(reader: &mut R, buf: &mut Vec<u8>) -> Result<bool, &'static str> {
    buf.clear();
    let n = reader.by_ref().take(MAX_LINE).read_until(b'\n', buf).map_err(|_| "io")?;
    match (n, buf.ends_with(b"\n")) {
        (0, _) => Ok(false),
        (_, true) => Ok(true),
        _ => Err("bad_response"),
    }
}

/// Resumen de un mensaje SSE completo. `None` si no es de una tarea; error si está fuera de contrato.
fn forward(name: &str, data: &str, token: &str) -> Result<Option<Forwarded>, &'static str> {
    if name == "error" {
        return Err("integrity_error");
    }
    if data.is_empty() {
        return Ok(None);
    }
    let json: serde_json::Value = serde_json::from_str(data).map_err(|_| "bad_response")?;
    let Some(stream) = json.get("stream").and_then(|s| s.as_str()) else {
        return Err("bad_response");
    };
    let Some(number) = stream.strip_prefix("task:") else {
        return Ok(None);
    };
    let int = |n: Option<u64>| n.filter(|n| (1..=MAX_SAFE).contains(n));
    let number = int(number.parse().ok());
    let seq = int(json.get("seq").and_then(|s| s.as_u64()));
    let kind = json.get("type").and_then(|t| t.as_str()).filter(|t| {
        !t.is_empty() && t.len() <= 64 && !t.contains(token) && t.chars().all(|c| c.is_ascii_lowercase() || "._".contains(c))
    });
    match (seq, number, kind) {
        (Some(seq), Some(number), Some(kind)) => Ok(Some(Forwarded::Task { seq, number, name: kind.to_owned() })),
        _ => Err("bad_response"),
    }
}

/// Abre el stream del daemon de `home` desde su último evento y entrega cada resumen a `emit`.
/// Vuelve con el motivo cerrado de por qué terminó.
pub fn stream_at(home: &Path, emit: &mut dyn FnMut(Forwarded)) -> &'static str {
    run(home, emit).err().unwrap_or("closed")
}

fn run(home: &Path, emit: &mut dyn FnMut(Forwarded)) -> Result<(), &'static str> {
    let (token, socket) = connection(home)?;
    let last = match get(&socket, &token, "/v1/health", 64 * 1024)? {
        (200, body) => serde_json::from_slice::<serde_json::Value>(&body)
            .ok()
            .and_then(|j| j.get("lastSeq")?.as_u64()),
        (401, _) => return Err("unauthorized"),
        _ => None,
    }
    .ok_or("bad_response")?;

    let mut stream = UnixStream::connect(&socket).map_err(|_| "no_socket")?;
    stream.set_read_timeout(Some(IDLE)).map_err(|_| "io")?;
    stream.set_write_timeout(Some(TIMEOUT)).map_err(|_| "io")?;
    let request = format!(
        "GET /v1/events HTTP/1.1\r\nHost: togi\r\nAuthorization: Bearer {token}\r\n\
         Accept: text/event-stream\r\nLast-Event-ID: {last}\r\n\r\n"
    );
    stream.write_all(request.as_bytes()).map_err(|_| "io")?;

    let mut reader = BufReader::new(stream);
    let mut buf = Vec::new();
    if !line(&mut reader, &mut buf)? {
        return Err("bad_response");
    }
    match String::from_utf8_lossy(&buf).split_whitespace().nth(1) {
        Some("200") => {}
        Some("401") => return Err("unauthorized"),
        _ => return Err("bad_response"),
    }
    let mut chunked = false;
    loop {
        if !line(&mut reader, &mut buf)? {
            return Err("bad_response");
        }
        let header = String::from_utf8_lossy(&buf).trim_end().to_ascii_lowercase();
        if header.is_empty() {
            break;
        }
        chunked |= header.starts_with("transfer-encoding:") && header.contains("chunked");
    }
    if !chunked {
        return Err("bad_response");
    }

    emit(Forwarded::Open);
    let mut body = BufReader::new(Chunked { inner: reader, left: 0, done: false });
    let (mut name, mut data) = (String::new(), String::new());
    while line(&mut body, &mut buf)? {
        let text = String::from_utf8_lossy(&buf);
        let text = text.trim_end_matches(['\r', '\n']);
        if text.is_empty() {
            if let Some(event) = forward(&name, &data, &token)? {
                emit(event);
            }
            name.clear();
            data.clear();
        } else if let Some(value) = text.strip_prefix("event:") {
            name = value.trim().to_owned();
        } else if let Some(value) = text.strip_prefix("data:") {
            if data.len() as u64 + value.len() as u64 > MAX_LINE {
                return Err("bad_response");
            }
            data.push_str(value.trim_start());
        }
    }
    Ok(())
}

/// Tercer comando que ve el webview. Arranca una sola vez el hilo que reenvía los eventos y
/// reconecta si el daemon se cae; las llamadas siguientes no hacen nada.
#[tauri::command]
pub fn watch_events(app: tauri::AppHandle) {
    static STARTED: AtomicBool = AtomicBool::new(false);
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || loop {
        let reason = match home() {
            Some(home) => stream_at(&home, &mut |event| {
                let _ = app.emit(EVENT, &event);
            }),
            None => "no_home",
        };
        let _ = app.emit(EVENT, &Forwarded::Closed { reason });
        std::thread::sleep(RETRY);
    });
}
