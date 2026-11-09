//! La cabecera de cada evento para la mesa en vivo (ADR-010 §3, enmienda del 10 de noviembre): hora,
//! actor y tipo, nunca el contenido, el usuario, la sesión ni el token. El daemon falso refleja el
//! token a propósito en los datos de los eventos.

use std::io::{Read, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread;
use togi_desktop_lib::events::{stream_with_headers_at, Forwarded, Header, Who};

const SENTINEL: &str = "tok-centinela-91b2e7d0";
static NEXT: AtomicUsize = AtomicUsize::new(0);

fn home() -> PathBuf {
    let n = NEXT.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("th-{}-{n}", std::process::id()));
    std::fs::create_dir_all(dir.join("run")).unwrap();
    std::fs::write(dir.join("credentials"), format!("{SENTINEL}\n")).unwrap();
    dir
}

fn request(stream: &mut UnixStream) {
    let (mut bytes, mut byte) = (Vec::new(), [0; 1]);
    while !bytes.ends_with(b"\r\n\r\n") {
        stream.read_exact(&mut byte).unwrap();
        bytes.push(byte[0]);
    }
}

/// Un evento como lo emite el daemon, con un `actor` dado y el token en el contenido.
fn message(seq: u64, kind: &str, actor: &str) -> String {
    let data = format!(
        r#"{{"seq":{seq},"stream":"task:3","type":"{kind}","at":"2026-11-10T09:30:00.123Z","actor":{actor},"payload":{{"text":"{SENTINEL}"}}}}"#
    );
    format!("event: {kind}\ndata: {data}\nid: {seq}\n\n")
}

/// Reenvía `sse` desde un daemon falso y devuelve los resúmenes y las cabeceras.
fn run(sse: String) -> (Vec<Forwarded>, Vec<Header>) {
    let home = home();
    let listener = UnixListener::bind(home.join("run").join("togi.sock")).unwrap();
    let daemon = thread::spawn(move || {
        let (mut health, _) = listener.accept().unwrap();
        request(&mut health);
        let body = r#"{"lastSeq":1}"#;
        write!(
            health,
            "HTTP/1.1 200 OK\r\ncontent-length: {}\r\n\r\n{body}",
            body.len()
        )
        .unwrap();
        let (mut events, _) = listener.accept().unwrap();
        request(&mut events);
        let _ = write!(
            events,
            "HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\n"
        );
        let _ = write!(events, "{:x}\r\n{sse}\r\n0\r\n\r\n", sse.len());
    });
    let (mut summaries, mut headers) = (Vec::new(), Vec::new());
    stream_with_headers_at(&home, &mut |s| summaries.push(s), &mut |h| headers.push(h));
    daemon.join().unwrap();
    let json = serde_json::to_string(&headers).unwrap();
    assert!(
        !json.contains(SENTINEL),
        "la cabecera lleva el token: {json}"
    );
    (summaries, headers)
}

fn head(seq: u64, name: &str, actor: Who) -> Header {
    Header {
        seq,
        at: "2026-11-10T09:30:00.123Z".to_owned(),
        number: 3,
        name: name.to_owned(),
        actor,
    }
}

#[test]
fn cada_evento_de_tarea_lleva_su_cabecera_con_quien_lo_emitio_sin_ids_ni_contenido() {
    let sse = format!(
        "{}{}{}",
        message(2, "task.submitted", r#"{"kind":"human","userId":"usr_1"}"#),
        message(
            3,
            "session.started",
            r#"{"kind":"agent","sessionId":"ses_x","role":"planner"}"#
        ),
        message(
            4,
            "gate.completed",
            r#"{"kind":"system","component":"gates"}"#
        ),
    );
    let (summaries, headers) = run(sse);
    assert_eq!(summaries.len(), 4, "Open y tres resúmenes, como siempre");
    assert_eq!(
        headers,
        vec![
            head(2, "task.submitted", Who::Human),
            head(
                3,
                "session.started",
                Who::Agent {
                    role: "planner".to_owned()
                }
            ),
            head(
                4,
                "gate.completed",
                Who::System {
                    component: "gates".to_owned()
                }
            ),
        ]
    );
    let json = serde_json::to_string(&headers).unwrap();
    assert!(!json.contains("usr_1") && !json.contains("ses_x"));
}

#[test]
fn sin_hora_o_con_un_actor_que_no_se_reconoce_no_hay_cabecera_pero_si_resumen() {
    let no_at = "event: task.created\ndata: {\"seq\":2,\"stream\":\"task:3\",\"type\":\"task.created\",\"actor\":{\"kind\":\"human\"}}\n\n";
    let sse = format!(
        "{no_at}{}{}{}",
        message(3, "task.edited", r#"{"kind":"robot"}"#),
        message(
            4,
            "task.edited",
            &format!(r#"{{"kind":"agent","role":"{SENTINEL}X"}}"#)
        ),
        message(
            5,
            "task.edited",
            r#"{"kind":"agent","role":"Planner Malo"}"#
        ),
    );
    let (summaries, headers) = run(sse);
    assert_eq!(summaries.len(), 5);
    assert!(headers.is_empty(), "{headers:?}");
}
