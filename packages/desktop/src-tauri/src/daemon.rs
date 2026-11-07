//! Cliente mínimo del daemon por su socket Unix (ADR-005, ADR-010 §1). El token se lee aquí y no
//! sale de este módulo: lo único que devuelve al webview es un `DaemonStatus`.

use serde::Serialize;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::time::Duration;

const TIMEOUT: Duration = Duration::from_secs(2);
const MAX_BODY: usize = 64 * 1024;

/// Estado que ve el webview. Sin cabeceras, sin cuerpo y sin texto libre del daemon.
#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum DaemonStatus {
    Running { version: String },
    Unreachable { reason: &'static str },
}

fn unreachable(reason: &'static str) -> DaemonStatus {
    DaemonStatus::Unreachable { reason }
}

/// `TOGI_HOME` o `~/.togi`, igual que el daemon y la CLI.
pub fn home() -> Option<PathBuf> {
    match std::env::var_os("TOGI_HOME") {
        Some(dir) => Some(PathBuf::from(dir)),
        None => std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".togi")),
    }
}

/// Pregunta `GET /v1/health` al daemon de `home`. Nunca devuelve el token ni nada que lo contenga.
pub fn status_at(home: &Path) -> DaemonStatus {
    let Ok(raw) = std::fs::read_to_string(home.join("credentials")) else {
        return unreachable("no_credentials");
    };
    let token = raw.trim();
    if token.is_empty() {
        return unreachable("no_credentials");
    }
    match health(&home.join("run").join("togi.sock"), token) {
        Ok((200, body)) => match version(&body, token) {
            Some(version) => DaemonStatus::Running { version },
            None => unreachable("bad_response"),
        },
        Ok((401, _)) => unreachable("unauthorized"),
        Ok(_) => unreachable("bad_response"),
        Err(reason) => unreachable(reason),
    }
}

/// Versión del daemon si es un valor corto y limpio que no contiene el token.
fn version(body: &[u8], token: &str) -> Option<String> {
    let json: serde_json::Value = serde_json::from_slice(body).ok()?;
    let version = json.get("daemon")?.as_str()?;
    let clean = !version.is_empty()
        && version.len() <= 32
        && version.chars().all(|c| c.is_ascii_alphanumeric() || ".-+".contains(c));
    (clean && !version.contains(token)).then(|| version.to_owned())
}

/// HTTP/1.1 a mano: una petición, `Connection: close`, respuesta con `Content-Length`. Lee con
/// `BufReader` para no depender de que la respuesta llegue en un solo trozo.
fn health(socket: &Path, token: &str) -> Result<(u16, Vec<u8>), &'static str> {
    let mut stream = UnixStream::connect(socket).map_err(|_| "no_socket")?;
    stream.set_read_timeout(Some(TIMEOUT)).map_err(|_| "io")?;
    stream.set_write_timeout(Some(TIMEOUT)).map_err(|_| "io")?;
    let request = format!(
        "GET /v1/health HTTP/1.1\r\nHost: togi\r\nAuthorization: Bearer {token}\r\n\
         Accept: application/json\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(request.as_bytes()).map_err(|_| "io")?;

    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader.read_line(&mut line).map_err(|_| "io")?;
    let code = line
        .split_whitespace()
        .nth(1)
        .and_then(|c| c.parse::<u16>().ok())
        .ok_or("bad_response")?;
    let mut length = None;
    loop {
        line.clear();
        if reader.read_line(&mut line).map_err(|_| "io")? == 0 {
            return Err("bad_response");
        }
        let header = line.trim_end();
        if header.is_empty() {
            break;
        }
        if let Some((name, value)) = header.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") {
                length = value.trim().parse::<usize>().ok();
            }
        }
    }
    let length = length.filter(|n| *n <= MAX_BODY).ok_or("bad_response")?;
    let mut body = vec![0; length];
    reader.read_exact(&mut body).map_err(|_| "bad_response")?;
    Ok((code, body))
}

/// Único comando que ve el webview. El trabajo bloqueante va a otro hilo para no congelar la ventana.
#[tauri::command]
pub async fn get_daemon_status() -> DaemonStatus {
    let Some(home) = home() else {
        return unreachable("no_home");
    };
    tauri::async_runtime::spawn_blocking(move || status_at(&home))
        .await
        .unwrap_or_else(|_| unreachable("internal"))
}
