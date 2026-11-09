//! El cursor de `read_trajectory` es de una sesión: si Rust elige otra, el `seq` guardado no vale
//! (cada sesión cuenta desde 1) y se avisa en vez de saltarse eventos. Además el cursor solo avanza,
//! el texto del agente no lleva caracteres invisibles y el recorte se marca (ADR-010 §8).

use serde_json::{json, Value};
use std::io::{Read, Write};
use std::os::unix::net::UnixListener;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread::{self, JoinHandle};
use togi_desktop_lib::trajectory::{trajectory_for, TrajectoryRead};

const TOKEN: &str = "tok-centinela-7f3a9c41";
const STARTED: &str = "2026-11-07T11:00:00.000Z";
static NEXT: AtomicUsize = AtomicUsize::new(0);

fn home() -> PathBuf {
    let n = NEXT.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("tc-{}-{n}", std::process::id()));
    std::fs::create_dir_all(dir.join("run")).unwrap();
    std::fs::write(dir.join("credentials"), format!("{TOKEN}\n")).unwrap();
    dir
}

/// Atiende una conexión por cuerpo, en orden, y devuelve cuántas peticiones recibió.
fn fake_daemon(home: &Path, bodies: Vec<String>) -> JoinHandle<usize> {
    let listener = UnixListener::bind(home.join("run").join("togi.sock")).unwrap();
    thread::spawn(move || {
        let mut served = 0;
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
            stream.write_all(head.as_bytes()).unwrap();
            served += 1;
        }
        served
    })
}

fn sessions() -> String {
    json!({ "sessions": [{ "sessionId": "ses_1", "state": "active", "startedAt": STARTED }] })
        .to_string()
}

fn event(seq: u64, content: Value) -> Value {
    json!({ "seq": seq, "at": STARTED, "kind": "message", "content": content, "contentErased": false })
}

fn page(events: Vec<Value>, next: u64) -> String {
    json!({ "events": events, "nextAfter": next, "hasMore": false, "sessionState": "active" })
        .to_string()
}

fn read(bodies: Vec<String>, after: u64, mark: Option<&str>) -> (Value, usize) {
    let home = home();
    let daemon = fake_daemon(&home, bodies);
    let result = trajectory_for(&home, 12, after, mark);
    let json = serde_json::to_value(&result).unwrap();
    assert!(
        !json.to_string().contains("ses_"),
        "el id de sesión sale: {json}"
    );
    (json, daemon.join().unwrap())
}

#[test]
fn la_respuesta_lleva_la_marca_de_la_sesion_y_la_misma_marca_sigue_valiendo() {
    let (first, _) = read(
        vec![sessions(), page(vec![event(1, json!("a"))], 1)],
        0,
        None,
    );
    assert_eq!(first["sessionMark"], STARTED);
    let (again, _) = read(
        vec![sessions(), page(vec![event(2, json!("b"))], 2)],
        1,
        Some(STARTED),
    );
    assert_eq!(again["status"], "ok");
}

#[test]
fn otra_sesion_avisa_y_no_pide_la_trayectoria() {
    let (json, served) = read(vec![sessions()], 30, Some("2026-11-07T09:00:00.000Z"));
    assert_eq!(json, json!({ "status": "session_changed" }));
    assert_eq!(served, 1);
}

#[test]
fn el_cursor_solo_avanza() {
    let bad = [
        page(vec![event(5, json!("x"))], 4),
        page(vec![event(5, json!("x")), event(5, json!("y"))], 5),
        page(vec![event(7, json!("x")), event(6, json!("y"))], 6),
        page(vec![event(3, json!("x"))], 3),
        page(vec![], 9),
    ];
    for body in bad {
        let (json, _) = read(vec![sessions(), body], 4, None);
        assert_eq!(json["status"], "unreachable");
        assert_eq!(json["reason"], "bad_response");
    }
    let (json, _) = read(
        vec![
            sessions(),
            page(vec![event(5, json!("x")), event(6, json!("y"))], 6),
        ],
        4,
        None,
    );
    assert_eq!(json["nextAfter"], 6);
    let (json, _) = read(vec![sessions(), page(vec![], 4)], 4, None);
    assert_eq!(json["nextAfter"], 4);
}

#[test]
fn quita_los_caracteres_invisibles_y_marca_el_recorte() {
    let sneaky = "ok\u{202e}evil\u{2066}\u{200b}\u{feff}\u{00ad}!";
    let long = "a".repeat(501);
    let body = page(
        vec![
            event(1, json!(sneaky)),
            event(2, json!(long)),
            event(3, json!("a".repeat(500))),
        ],
        3,
    );
    let (json, _) = read(vec![sessions(), body], 0, None);
    let events = json["events"].as_array().unwrap();
    assert_eq!(events[0]["text"], "okevil!");
    assert_eq!(events[0]["truncated"], false);
    assert_eq!(events[1]["text"].as_str().unwrap().len(), 500);
    assert_eq!(events[1]["truncated"], true);
    assert_eq!(events[2]["truncated"], false);
}

#[test]
fn trajectory_for_con_numero_invalido_no_llega_al_daemon() {
    let result = trajectory_for(&home(), 0, 0, None);
    assert!(matches!(
        result,
        TrajectoryRead::Unreachable {
            reason: "invalid_request"
        }
    ));
}
