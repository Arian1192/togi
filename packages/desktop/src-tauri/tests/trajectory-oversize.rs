//! Una página de trayectoria mayor que el cuerpo máximo no puede dejar la lectura bloqueada: se
//! reintenta con un solo evento y, si ni ese cabe, se devuelve una fila marcadora y el cursor avanza.

use serde_json::{json, Value};
use std::io::{Read, Write};
use std::os::unix::net::UnixListener;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread::{self, JoinHandle};
use togi_desktop_lib::trajectory::trajectory_at;

const TOKEN: &str = "tok-centinela-7f3a9c41";
const STARTED: &str = "2026-11-07T11:00:00.000Z";
static NEXT: AtomicUsize = AtomicUsize::new(0);

fn home() -> PathBuf {
    let n = NEXT.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("to-{}-{n}", std::process::id()));
    std::fs::create_dir_all(dir.join("run")).unwrap();
    std::fs::write(dir.join("credentials"), format!("{TOKEN}\n")).unwrap();
    dir
}

/// Atiende una conexión por cuerpo, en orden, y devuelve las líneas de petición recibidas.
fn fake_daemon(home: &Path, bodies: Vec<String>) -> JoinHandle<Vec<String>> {
    let listener = UnixListener::bind(home.join("run").join("togi.sock")).unwrap();
    thread::spawn(move || {
        let mut lines = Vec::new();
        for body in bodies {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            let mut byte = [0; 1];
            while !request.ends_with(b"\r\n\r\n") {
                stream.read_exact(&mut byte).unwrap();
                request.push(byte[0]);
            }
            let head = format!(
                "HTTP/1.1 200 OK\r\ncontent-length: {}\r\n\r\n{body}",
                body.len()
            );
            // El cliente corta si el cuerpo supera su límite.
            let _ = stream.write_all(head.as_bytes());
            let text = String::from_utf8(request).unwrap();
            lines.push(text.lines().next().unwrap().to_owned());
        }
        lines
    })
}

fn sessions(state: &str) -> String {
    json!({ "sessions": [{ "sessionId": "ses_1", "state": state, "startedAt": STARTED }] })
        .to_string()
}

fn big_page() -> String {
    let event = json!({ "seq": 5, "at": STARTED, "kind": "message", "contentErased": false,
        "content": "x".repeat(2 * 1024 * 1024) });
    json!({ "events": [event], "nextAfter": 5, "hasMore": false, "sessionState": "active" })
        .to_string()
}

fn one_event_page() -> String {
    let event = json!({ "seq": 5, "at": STARTED, "kind": "message", "contentErased": false, "content": "cabe" });
    json!({ "events": [event], "nextAfter": 5, "hasMore": true, "sessionState": "active" })
        .to_string()
}

fn read(bodies: Vec<String>) -> (Value, Vec<String>) {
    let home = home();
    let daemon = fake_daemon(&home, bodies);
    let result = trajectory_at(&home, 12, 4);
    (
        serde_json::to_value(&result).unwrap(),
        daemon.join().unwrap(),
    )
}

#[test]
fn si_la_pagina_no_cabe_reintenta_con_un_solo_evento() {
    let (json, lines) = read(vec![sessions("active"), big_page(), one_event_page()]);
    assert!(lines[1].contains("after=4&limit=20"));
    assert!(lines[2].contains("after=4&limit=1"));
    assert_eq!(json["status"], "ok");
    assert_eq!(json["events"][0]["text"], "cabe");
    assert_eq!(json["nextAfter"], 5);
}

#[test]
fn si_ni_un_evento_cabe_devuelve_una_fila_marcadora_y_avanza_el_cursor() {
    let (json, lines) = read(vec![sessions("ended"), big_page(), big_page()]);
    assert_eq!(lines.len(), 3);
    assert_eq!(json["status"], "ok");
    assert_eq!(json["nextAfter"], 5);
    assert_eq!(json["hasMore"], true);
    assert_eq!(json["sessionState"], "ended");
    let events = json["events"].as_array().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0]["seq"], 5);
    assert_eq!(events[0]["kind"], "oversized");
    assert_eq!(events[0]["text"], "");
}

#[test]
fn un_cuerpo_que_no_es_json_no_se_reintenta_ni_se_marca() {
    let (json, lines) = read(vec![sessions("active"), "no es json".to_owned()]);
    assert_eq!(lines.len(), 2);
    assert_eq!(
        json,
        json!({ "status": "unreachable", "reason": "bad_response" })
    );
}
