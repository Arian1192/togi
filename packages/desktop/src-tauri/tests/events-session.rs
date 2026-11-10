//! La etiqueta de sesión para la mesa en vivo: distingue dos agentes del mismo rol en la misma
//! tarea sin que el id de sesión salga de Rust. El daemon falso pone el token y los ids en los datos.

use std::io::{Read, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread;
use togi_desktop_lib::events::{stream_with_sessions_at, Header, SessionTag};

const SENTINEL: &str = "tok-centinela-5c8a1f2e";
static NEXT: AtomicUsize = AtomicUsize::new(0);

fn home() -> PathBuf {
    let n = NEXT.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("ts-{}-{n}", std::process::id()));
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

fn message(seq: u64, kind: &str, actor: &str, payload: &str) -> String {
    let data = format!(
        r#"{{"seq":{seq},"stream":"task:3","type":"{kind}","at":"2026-11-10T09:30:00Z","actor":{actor},"payload":{payload}}}"#
    );
    format!("event: {kind}\ndata: {data}\nid: {seq}\n\n")
}

/// Lo que llega, en orden: «h<seq>» por cada cabecera y «s<seq>» por cada etiqueta.
fn run(sse: String) -> (Vec<String>, Vec<SessionTag>) {
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
    let order = std::cell::RefCell::new(Vec::new());
    let mut tags = Vec::new();
    stream_with_sessions_at(
        &home,
        &mut |_| {},
        &mut |h: Header| order.borrow_mut().push(format!("h{}", h.seq)),
        &mut |t: SessionTag| {
            order.borrow_mut().push(format!("s{}", t.seq));
            tags.push(t);
        },
    );
    daemon.join().unwrap();
    let json = serde_json::to_string(&tags).unwrap();
    assert!(!json.contains(SENTINEL) && !json.contains("ses_"), "{json}");
    (order.into_inner(), tags)
}

const PLANNER: &str = r#"{"kind":"system","component":"adapter:planner"}"#;

#[test]
fn dos_sesiones_del_mismo_rol_y_tarea_llevan_etiquetas_distintas_y_cada_una_la_suya_siempre() {
    let a = r#"{"sessionId":"ses_aaaa-1111"}"#;
    let b = r#"{"sessionId":"ses_bbbb-2222"}"#;
    let sse = format!(
        "{}{}{}{}",
        message(2, "session.started", PLANNER, a),
        message(3, "session.started", PLANNER, b),
        message(
            4,
            "plan.proposed",
            r#"{"kind":"agent","role":"planner","sessionId":"ses_aaaa-1111"}"#,
            r#"{"text":"tok-centinela-5c8a1f2e"}"#
        ),
        message(5, "session.ended", PLANNER, b),
    );
    let (order, tags) = run(sse);
    assert_eq!(order, ["s2", "h2", "s3", "h3", "s4", "h4", "s5", "h5"]);
    let label = |seq: u64| tags.iter().find(|t| t.seq == seq).unwrap().session.clone();
    assert_ne!(label(2), label(3), "dos sesiones, dos etiquetas");
    assert_eq!(label(2), label(4), "el plan es de la sesión que abrió el 2");
    assert_eq!(label(3), label(5));
    assert!(label(2).starts_with('s') && label(2).len() == 17);
}

#[test]
fn sin_sesion_o_con_un_id_que_no_tiene_su_forma_no_hay_etiqueta() {
    let sse = format!(
        "{}{}{}",
        message(
            2,
            "task.submitted",
            r#"{"kind":"human","userId":"usr_1"}"#,
            "{}"
        ),
        message(
            3,
            "session.started",
            PLANNER,
            r#"{"sessionId":"no es una sesión"}"#
        ),
        message(
            4,
            "session.started",
            PLANNER,
            &format!(r#"{{"sessionId":"ses_{SENTINEL}/x"}}"#)
        ),
    );
    let (order, tags) = run(sse);
    assert_eq!(order, ["h2", "h3", "h4"]);
    assert!(tags.is_empty());
}
