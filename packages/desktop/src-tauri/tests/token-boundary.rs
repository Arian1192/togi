//! El token nunca sale del lado Rust (ADR-005, ADR-010 §1). El daemon falso responde como el real
//! (con `Content-Length`, en trozos) y lo refleja a propósito en cabeceras y cuerpo: lo que
//! devuelve el comando, serializado, no puede contenerlo.

use std::io::{Read, Write};
use std::os::unix::net::UnixListener;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use togi_desktop_lib::daemon::{status_at, DaemonStatus};

const SENTINEL: &str = "tok-centinela-7f3a9c41";
static NEXT: AtomicUsize = AtomicUsize::new(0);

/// Un `TOGI_HOME` corto (la ruta de un socket Unix tiene un límite) con las credenciales.
fn home(token: Option<&str>) -> PathBuf {
    let n = NEXT.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("td-{}-{n}", std::process::id()));
    std::fs::create_dir_all(dir.join("run")).unwrap();
    if let Some(token) = token {
        std::fs::write(dir.join("credentials"), format!("{token}\n")).unwrap();
    }
    dir
}

/// Daemon falso: lee la petición, comprueba el token y responde `status` con `body`, partiendo
/// cabeceras y cuerpo en trozos con pausas. Devuelve la petición que recibió.
fn fake_daemon(home: &PathBuf, status: &str, body: String) -> JoinHandle<String> {
    let listener = UnixListener::bind(home.join("run").join("togi.sock")).unwrap();
    let status = status.to_owned();
    thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = Vec::new();
        let mut byte = [0; 1];
        while !request.ends_with(b"\r\n\r\n") {
            stream.read_exact(&mut byte).unwrap();
            request.push(byte[0]);
        }
        let response = format!(
            "HTTP/1.1 {status}\r\ncontent-type: application/json\r\nx-echo: Bearer {SENTINEL}\r\n\
             content-length: {}\r\n\r\n{body}",
            body.len()
        );
        for chunk in response.as_bytes().chunks(7) {
            stream.write_all(chunk).unwrap();
            stream.flush().unwrap();
            thread::sleep(Duration::from_millis(2));
        }
        String::from_utf8(request).unwrap()
    })
}

fn health_body(version: &str) -> String {
    format!(r#"{{"daemon":"{version}","schema":9,"pid":1,"lastSeq":0,"echo":"{SENTINEL}"}}"#)
}

fn assert_clean(status: &DaemonStatus) -> String {
    let json = serde_json::to_string(status).unwrap();
    assert!(!json.contains(SENTINEL), "el estado contiene el token: {json}");
    json
}

#[test]
fn un_daemon_que_responde_en_trozos_da_su_version_sin_el_token() {
    let home = home(Some(SENTINEL));
    let daemon = fake_daemon(&home, "200 OK", health_body("0.3.1"));
    let status = status_at(&home);
    let request = daemon.join().unwrap();
    assert!(request.starts_with("GET /v1/health HTTP/1.1\r\n"));
    assert!(request.contains(&format!("Authorization: Bearer {SENTINEL}\r\n")));
    assert_eq!(assert_clean(&status), r#"{"state":"running","version":"0.3.1"}"#);
}

#[test]
fn una_version_que_contiene_el_token_no_se_devuelve() {
    let home = home(Some(SENTINEL));
    let daemon = fake_daemon(&home, "200 OK", health_body(SENTINEL));
    let status = status_at(&home);
    daemon.join().unwrap();
    assert_eq!(status, DaemonStatus::Unreachable { reason: "bad_response" });
    assert_clean(&status);
}

#[test]
fn un_401_que_refleja_el_token_da_unauthorized_sin_el_cuerpo() {
    let home = home(Some(SENTINEL));
    let daemon = fake_daemon(&home, "401 Unauthorized", format!(r#"{{"detail":"{SENTINEL}"}}"#));
    let status = status_at(&home);
    daemon.join().unwrap();
    assert_eq!(assert_clean(&status), r#"{"state":"unreachable","reason":"unauthorized"}"#);
}

#[test]
fn sin_socket_el_daemon_no_responde_y_el_motivo_no_lleva_el_token() {
    let home = home(Some(SENTINEL));
    let status = status_at(&home);
    assert_eq!(assert_clean(&status), r#"{"state":"unreachable","reason":"no_socket"}"#);
}

#[test]
fn sin_credenciales_no_se_intenta_conectar() {
    let home = home(None);
    assert_eq!(status_at(&home), DaemonStatus::Unreachable { reason: "no_credentials" });
}
