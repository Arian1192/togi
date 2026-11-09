//! `read_trajectory` devuelve texto acotado y nunca el token, ni JSON del agente, ni un id de sesión
//! (ADR-005, ADR-010 §1 y §8). Rust elige la sesión: la activa, o la última. El daemon falso responde
//! como el real (`Content-Length`, en trozos) y refleja el token a propósito.

use serde_json::{json, Value};
use std::io::{Read, Write};
use std::os::unix::net::UnixListener;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use togi_desktop_lib::trajectory::{trajectory_at, TrajectoryRead};

const SENTINEL: &str = "tok-centinela-7f3a9c41";
static NEXT: AtomicUsize = AtomicUsize::new(0);

fn home(token: Option<&str>) -> PathBuf {
    let n = NEXT.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("tt-{}-{n}", std::process::id()));
    std::fs::create_dir_all(dir.join("run")).unwrap();
    if let Some(token) = token {
        std::fs::write(dir.join("credentials"), format!("{token}\n")).unwrap();
    }
    dir
}

/// Daemon falso: atiende una conexión por respuesta, en orden, y devuelve las peticiones recibidas.
fn fake_daemon(home: &Path, replies: Vec<(&str, String)>) -> JoinHandle<Vec<String>> {
    let listener = UnixListener::bind(home.join("run").join("togi.sock")).unwrap();
    let replies: Vec<(String, String)> = replies
        .into_iter()
        .map(|(s, b)| (s.to_owned(), b))
        .collect();
    thread::spawn(move || {
        let mut seen = Vec::new();
        for (status, body) in replies {
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
            for part in response.as_bytes().chunks(9) {
                // El cliente puede cortar antes de leerlo todo (cuerpo mayor que su límite).
                if stream.write_all(part).is_err() {
                    break;
                }
                thread::sleep(Duration::from_millis(1));
            }
            seen.push(String::from_utf8(request).unwrap());
        }
        seen
    })
}

fn sessions(list: Value) -> (&'static str, String) {
    ("200 OK", json!({ "sessions": list }).to_string())
}

fn session(id: &str, state: &str, started: &str) -> Value {
    json!({ "sessionId": id, "state": state, "startedAt": started, "model": SENTINEL })
}

fn page(events: Value, has_more: bool, state: &str) -> (&'static str, String) {
    let next = events
        .as_array()
        .and_then(|a| a.last())
        .map_or(0, |e| e["seq"].as_u64().unwrap());
    (
        "200 OK",
        json!({ "events": events, "nextAfter": next, "hasMore": has_more, "sessionState": state })
            .to_string(),
    )
}

fn event(seq: u64, kind: &str, content: Value) -> Value {
    json!({ "seq": seq, "at": "2026-11-07T12:00:00.000Z", "kind": kind, "content": content, "contentErased": false })
}

fn read(replies: Vec<(&str, String)>, after: u64) -> (TrajectoryRead, Vec<String>) {
    let home = home(Some(SENTINEL));
    let daemon = fake_daemon(&home, replies);
    let result = trajectory_at(&home, 12, after);
    (result, daemon.join().unwrap())
}

fn clean(result: &TrajectoryRead) -> String {
    let json = serde_json::to_string(result).unwrap();
    assert!(
        !json.contains(SENTINEL) && !json.contains("ses_"),
        "la respuesta contiene el token o un id de sesión: {json}"
    );
    json
}

fn reason(result: &TrajectoryRead) -> &'static str {
    match result {
        TrajectoryRead::Unreachable { reason } => reason,
        other => panic!("se esperaba un motivo: {other:?}"),
    }
}

#[test]
fn devuelve_texto_acotado_de_los_cinco_tipos_sin_json_del_agente() {
    let events = json!([
        event(1, "message", json!({ "text": "Leo el plan" })),
        event(
            2,
            "tool_call",
            json!({ "tool": "Bash", "command": SENTINEL.len() })
        ),
        event(3, "tool_result", json!({ "isError": false })),
        event(4, "denied", json!({ "reason": "fuera del plan" })),
        event(5, "usage", json!({ "in": 3 })),
    ]);
    let (result, seen) = read(
        vec![
            sessions(json!([session(
                "ses_1",
                "active",
                "2026-11-07T11:00:00.000Z"
            )])),
            page(events, true, "active"),
        ],
        0,
    );
    let json: Value = serde_json::from_str(&clean(&result)).unwrap();
    assert_eq!(json["status"], "ok");
    assert_eq!(json["hasMore"], true);
    assert_eq!(json["nextAfter"], 5);
    assert_eq!(json["sessionState"], "active");
    let rows: Vec<(&str, &str)> = json["events"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| (e["kind"].as_str().unwrap(), e["text"].as_str().unwrap()))
        .collect();
    assert_eq!(
        rows,
        [
            ("message", "Leo el plan"),
            ("tool_call", "Bash"),
            ("tool_result", ""),
            ("denied", "fuera del plan"),
            ("usage", ""),
        ]
    );
    assert!(seen[0].starts_with("GET /v1/tasks/12/sessions HTTP/1.1"));
    assert!(
        seen[1].starts_with("GET /v1/tasks/12/sessions/ses_1/trajectory?after=0&limit=20 HTTP/1.1")
    );
}

#[test]
fn elige_la_sesion_activa_y_si_no_hay_la_ultima() {
    let list = json!([
        session("ses_a", "ended", "2026-11-07T09:00:00.000Z"),
        session("ses_b", "active", "2026-11-07T10:00:00.000Z"),
        session("ses_c", "ended", "2026-11-07T11:00:00.000Z"),
    ]);
    let (_, seen) = read(vec![sessions(list), page(json!([]), false, "active")], 0);
    assert!(seen[1].contains("/sessions/ses_b/trajectory"));
    let list = json!([
        session("ses_a", "ended", "2026-11-07T11:00:00.000Z"),
        session("ses_b", "ended", "2026-11-07T09:00:00.000Z"),
    ]);
    let (_, seen) = read(vec![sessions(list), page(json!([]), false, "ended")], 0);
    assert!(seen[1].contains("/sessions/ses_a/trajectory"));
}

#[test]
fn sin_sesiones_no_pide_la_trayectoria() {
    let (result, seen) = read(vec![sessions(json!([]))], 0);
    assert_eq!(clean(&result), r#"{"status":"no_session"}"#);
    assert_eq!(seen.len(), 1);
}

#[test]
fn pasa_el_cursor_after() {
    let list = json!([session("ses_1", "active", "2026-11-07T11:00:00.000Z")]);
    let empty =
        json!({ "events": [], "nextAfter": 41, "hasMore": false, "sessionState": "active" });
    let (_, seen) = read(vec![sessions(list), ("200 OK", empty.to_string())], 41);
    assert!(seen[1].contains("?after=41&limit=20"));
}

#[test]
fn el_texto_se_acota_y_lo_borrado_sale_sin_texto() {
    let long = "á".repeat(2_000);
    let mut erased = event(2, "message", json!("[borrado]"));
    erased["contentErased"] = json!(true);
    let (result, _) = read(
        vec![
            sessions(json!([session(
                "ses_1",
                "active",
                "2026-11-07T11:00:00.000Z"
            )])),
            page(
                json!([event(1, "message", json!(long)), erased]),
                false,
                "active",
            ),
        ],
        0,
    );
    let json: Value = serde_json::from_str(&clean(&result)).unwrap();
    assert_eq!(
        json["events"][0]["text"].as_str().unwrap().chars().count(),
        500
    );
    assert_eq!(json["events"][1]["text"], "");
    assert_eq!(json["events"][1]["erased"], true);
}

#[test]
fn el_contenido_del_agente_sale_como_texto_inerte() {
    let (result, _) = read(
        vec![
            sessions(json!([session(
                "ses_1",
                "active",
                "2026-11-07T11:00:00.000Z"
            )])),
            page(
                json!([event(
                    1,
                    "message",
                    json!("<img src=x onerror=alert(1)>\u{1b}[31m")
                )]),
                false,
                "active",
            ),
        ],
        0,
    );
    let json: Value = serde_json::from_str(&clean(&result)).unwrap();
    // Se devuelve tal cual, como cadena JSON: pintarlo como texto es cosa del frontend (ADR-010 §8).
    // Los caracteres de control sí se quitan.
    assert_eq!(
        json["events"][0]["text"],
        "<img src=x onerror=alert(1)>[31m"
    );
}

#[test]
fn un_evento_con_el_token_invalida_la_pagina_entera() {
    let list = json!([session("ses_1", "active", "2026-11-07T11:00:00.000Z")]);
    let events = json!([
        event(1, "message", json!("ok")),
        event(2, "message", json!(SENTINEL))
    ]);
    let (result, _) = read(vec![sessions(list), page(events, false, "active")], 0);
    assert_eq!(reason(&result), "bad_response");
}

#[test]
fn datos_fuera_de_contrato_se_rechazan() {
    let list = || {
        sessions(json!([session(
            "ses_1",
            "active",
            "2026-11-07T11:00:00.000Z"
        )]))
    };
    let bad = [
        page(json!([event(1, "read", json!("x"))]), false, "active"),
        page(json!([event(0, "message", json!("x"))]), false, "active"),
        page(json!([event(1, "message", json!("x"))]), false, "paused"),
        ("200 OK", "no es json".to_owned()),
    ];
    for reply in bad {
        let (result, _) = read(vec![list(), reply], 0);
        assert_eq!(reason(&result), "bad_response");
    }
    let hostile = sessions(json!([session(
        "ses_1/../../x",
        "active",
        "2026-11-07T11:00:00.000Z"
    )]));
    let (result, seen) = read(vec![hostile], 0);
    assert_eq!(reason(&result), "bad_response");
    assert_eq!(seen.len(), 1);
}

#[test]
fn un_cuerpo_demasiado_grande_es_bad_response() {
    let list = json!([session("ses_1", "active", "2026-11-07T11:00:00.000Z")]);
    let events = json!([event(1, "message", json!("x".repeat(2 * 1024 * 1024)))]);
    let (result, _) = read(vec![sessions(list), page(events, false, "active")], 0);
    assert_eq!(reason(&result), "bad_response");
}

#[test]
fn los_errores_del_daemon_son_motivos_cerrados() {
    for (status, expected) in [
        ("401 Unauthorized", "unauthorized"),
        ("404 Not Found", "not_found"),
    ] {
        let (result, _) = read(vec![(status, json!({ "detail": SENTINEL }).to_string())], 0);
        assert_eq!(reason(&result), expected);
        clean(&result);
    }
    let list = json!([session("ses_1", "active", "2026-11-07T11:00:00.000Z")]);
    let (result, _) = read(vec![sessions(list), ("404 Not Found", "{}".to_owned())], 0);
    assert_eq!(reason(&result), "not_found");
}

#[test]
fn numero_invalido_y_sin_daemon() {
    let home = home(Some(SENTINEL));
    assert_eq!(reason(&trajectory_at(&home, 0, 0)), "invalid_request");
    assert_eq!(reason(&trajectory_at(&home, 1 << 53, 0)), "invalid_request");
    assert_eq!(reason(&trajectory_at(&home, 1, 1 << 53)), "invalid_request");
    assert_eq!(reason(&trajectory_at(&home, 1, 0)), "no_socket");
    assert_eq!(
        reason(&trajectory_at(&self::home(None), 1, 0)),
        "no_credentials"
    );
}
