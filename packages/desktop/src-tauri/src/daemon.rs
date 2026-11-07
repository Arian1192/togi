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

/// El token y el socket del daemon de `home`, o el motivo cerrado de que no se pueda. El token no
/// sale del lado Rust: quien lo recibe solo lo usa para `get` y para comprobar que no se filtra.
pub(crate) fn connection(home: &Path) -> Result<(String, PathBuf), &'static str> {
    let raw = std::fs::read_to_string(home.join("credentials")).map_err(|_| "no_credentials")?;
    let token = raw.trim();
    if token.is_empty() {
        return Err("no_credentials");
    }
    Ok((token.to_owned(), home.join("run").join("togi.sock")))
}

/// Pregunta `GET /v1/health` al daemon de `home`. Nunca devuelve el token ni nada que lo contenga.
pub fn status_at(home: &Path) -> DaemonStatus {
    let (token, socket) = match connection(home) {
        Ok(connection) => connection,
        Err(reason) => return unreachable(reason),
    };
    let token = token.as_str();
    match get(&socket, token, "/v1/health", MAX_BODY) {
        Ok((200, body)) => match version(&body, token) {
            Some(version) => DaemonStatus::Running { version },
            None => unreachable("bad_response"),
        },
        Ok((401, _)) => unreachable("unauthorized"),
        Ok(_) => unreachable("bad_response"),
        Err(reason) => unreachable(reason),
    }
}

/// La versión como la cuenta `togi daemon status`: `v0.2.5 (aae6fce)` si hay instalación, `dev` si
/// corre desde el repo y, en un daemon viejo sin `release`, la de su package.json. La etiqueta debe
/// ser corta y limpia y no contener el token.
fn version(body: &[u8], token: &str) -> Option<String> {
    let json: serde_json::Value = serde_json::from_slice(body).ok()?;
    let field = |name: &str| json.get(name).and_then(serde_json::Value::as_str);
    let tag = field("release").or_else(|| field("daemon"))?;
    let clean = !tag.is_empty()
        && tag.len() <= 64
        && !tag.contains(token)
        && tag
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || ".-+".contains(c));
    if !clean {
        return None;
    }
    match field("commit") {
        Some(c) if c.len() == 40 && c.chars().all(|c| c.is_ascii_hexdigit()) => {
            Some(format!("{tag} ({})", &c[..7]))
        }
        _ => Some(tag.to_owned()),
    }
}

/// Un `GET` de `path`; mira `request`.
pub(crate) fn get(
    socket: &Path,
    token: &str,
    path: &str,
    max_body: usize,
) -> Result<(u16, Vec<u8>), &'static str> {
    request(socket, token, "GET", path, &[], None, max_body).map(|reply| (reply.code, reply.body))
}

/// Lo que devuelve `request`: el código, la cabecera `ETag` tal cual y el cuerpo.
pub(crate) struct Reply {
    pub code: u16,
    pub etag: Option<String>,
    pub body: Vec<u8>,
}

/// HTTP/1.1 a mano: `method` de `path`, `Connection: close`, respuesta con `Content-Length` de a lo
/// sumo `max_body` bytes. Con `body` manda JSON con su `Content-Length`. Lee con `BufReader` para
/// no depender de que la respuesta llegue en un solo trozo. El método, la ruta y las cabeceras los
/// pone cada comando, nunca el webview.
pub(crate) fn request(
    socket: &Path,
    token: &str,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: Option<&[u8]>,
    max_body: usize,
) -> Result<Reply, &'static str> {
    let mut stream = UnixStream::connect(socket).map_err(|_| "no_socket")?;
    stream.set_read_timeout(Some(TIMEOUT)).map_err(|_| "io")?;
    stream.set_write_timeout(Some(TIMEOUT)).map_err(|_| "io")?;
    let mut head = format!(
        "{method} {path} HTTP/1.1\r\nHost: togi\r\nAuthorization: Bearer {token}\r\n\
         Accept: application/json\r\nConnection: close\r\n"
    );
    for (name, value) in headers {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    if let Some(body) = body {
        head.push_str(&format!(
            "Content-Type: application/json\r\nContent-Length: {}\r\n",
            body.len()
        ));
    }
    head.push_str("\r\n");
    stream.write_all(head.as_bytes()).map_err(|_| "io")?;
    stream
        .write_all(body.unwrap_or_default())
        .map_err(|_| "io")?;

    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader.read_line(&mut line).map_err(|_| "io")?;
    let code = line
        .split_whitespace()
        .nth(1)
        .and_then(|c| c.parse::<u16>().ok())
        .ok_or("bad_response")?;
    let mut length = None;
    let mut etag = None;
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
            } else if name.eq_ignore_ascii_case("etag") {
                etag = Some(value.trim().to_owned());
            }
        }
    }
    let length = length.filter(|n| *n <= max_body).ok_or("bad_response")?;
    let mut body = vec![0; length];
    reader.read_exact(&mut body).map_err(|_| "bad_response")?;
    Ok(Reply { code, etag, body })
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
