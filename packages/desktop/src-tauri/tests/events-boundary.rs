//! El reenvío de eventos entrega solo un resumen y nunca el token (ADR-005, ADR-010 §1). El daemon
//! falso responde como el real (SSE con `Transfer-Encoding: chunked`) y refleja el token a propósito
//! en cabeceras y en los datos de los eventos.

use std::io::{Read, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use togi_desktop_lib::events::{stream_at, Forwarded};

const SENTINEL: &str = "tok-centinela-7f3a9c41";
static NEXT: AtomicUsize = AtomicUsize::new(0);

fn home(token: Option<&str>) -> PathBuf {
    let n = NEXT.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("te-{}-{n}", std::process::id()));
    std::fs::create_dir_all(dir.join("run")).unwrap();
    if let Some(token) = token {
        std::fs::write(dir.join("credentials"), format!("{token}\n")).unwrap();
    }
    dir
}

fn request(stream: &mut UnixStream) -> String {
    let (mut bytes, mut byte) = (Vec::new(), [0; 1]);
    while !bytes.ends_with(b"\r\n\r\n") {
        stream.read_exact(&mut byte).unwrap();
        bytes.push(byte[0]);
    }
    String::from_utf8(bytes).unwrap()
}

/// Un mensaje SSE como lo emite el daemon: `event`, `data` con el `DomainEvent` e `id`.
fn message(seq: u64, stream: &str, kind: &str) -> String {
    let data = format!(
        r#"{{"seq":{seq},"stream":"{stream}","type":"{kind}","at":"2026-11-07T12:00:00Z","actor":{{"kind":"human"}},"echo":"{SENTINEL}"}}"#
    );
    format!("event: {kind}\ndata: {data}\nid: {seq}\n\n")
}

/// Daemon falso: responde `/v1/health` (con `lastSeq`) y luego `/v1/events` con `sse` partido en
/// trozos de `chunk` bytes y cada trozo en su propio `Transfer-Encoding: chunked`. Devuelve las
/// peticiones recibidas.
fn fake_daemon(home: &Path, status: &str, sse: String, chunk: usize) -> JoinHandle<Vec<String>> {
    let listener = UnixListener::bind(home.join("run").join("togi.sock")).unwrap();
    let status = status.to_owned();
    thread::spawn(move || {
        let (mut health, _) = listener.accept().unwrap();
        let first = request(&mut health);
        let body = format!(r#"{{"daemon":"x","lastSeq":41,"echo":"{SENTINEL}"}}"#);
        write!(
            health,
            "HTTP/1.1 200 OK\r\ncontent-length: {}\r\n\r\n{body}",
            body.len()
        )
        .unwrap();
        let (mut events, _) = listener.accept().unwrap();
        let second = request(&mut events);
        write!(
            events,
            "HTTP/1.1 {status}\r\ntransfer-encoding: chunked\r\nx-echo: Bearer {SENTINEL}\r\n\r\n"
        )
        .unwrap();
        // El cliente puede cortar antes de que acabe el cuerpo (un error de contrato): no es un fallo.
        let _ = (|| -> std::io::Result<()> {
            for part in sse.as_bytes().chunks(chunk) {
                write!(events, "{:x}\r\n", part.len())?;
                events.write_all(part)?;
                events.write_all(b"\r\n")?;
                events.flush()?;
                thread::sleep(Duration::from_millis(1));
            }
            events.write_all(b"0\r\n\r\n")
        })();
        vec![first, second]
    })
}

/// Reenvía el stream de un daemon falso: lo emitido, el motivo con que terminó y las peticiones.
fn run(status: &str, sse: String, chunk: usize) -> (Vec<Forwarded>, &'static str, Vec<String>) {
    let home = home(Some(SENTINEL));
    let daemon = fake_daemon(&home, status, sse, chunk);
    let mut got = Vec::new();
    let reason = stream_at(&home, &mut |event| got.push(event));
    let json = serde_json::to_string(&got).unwrap();
    assert!(
        !json.contains(SENTINEL),
        "lo reenviado contiene el token: {json}"
    );
    (got, reason, daemon.join().unwrap())
}

fn task(seq: u64, number: u64, name: &str) -> Forwarded {
    Forwarded::Task {
        seq,
        number,
        name: name.to_owned(),
    }
}

#[test]
fn reenvia_un_resumen_por_cada_evento_de_tarea_aunque_lleguen_en_trozos_de_un_byte() {
    let sse = format!(
        ": ping\n\n{}{}{}",
        message(42, "task:7", "task.created"),
        message(43, "admin", "data.erased"),
        message(44, "task:7", "task.state_changed"),
    );
    for chunk in [1, 5, 4096] {
        let (got, reason, requests) = run("200 OK", sse.clone(), chunk);
        assert_eq!(
            got,
            vec![
                Forwarded::Open,
                task(42, 7, "task.created"),
                task(44, 7, "task.state_changed")
            ],
            "trozos de {chunk}"
        );
        assert_eq!(reason, "closed");
        // Empieza en el último evento del log, no reproduce el historial, y lleva el token al daemon.
        assert!(requests[1].starts_with("GET /v1/events HTTP/1.1\r\n"));
        assert!(requests[1].contains("Last-Event-ID: 41\r\n"));
        assert!(requests[1].contains(&format!("Authorization: Bearer {SENTINEL}\r\n")));
    }
}

#[test]
fn un_evento_de_error_o_fuera_de_contrato_termina_el_stream_con_un_motivo_cerrado() {
    let bad = |event: &str, data: &str| {
        format!(
            "{}event: {event}\ndata: {data}\n\n",
            message(42, "task:1", "task.created")
        )
    };
    for (sse, reason) in [
        (
            bad("error", r#"{"code":"integrity_error","seq":43}"#),
            "integrity_error",
        ),
        (bad("task.created", "no es json"), "bad_response"),
        (
            bad(
                "task.created",
                r#"{"seq":0,"stream":"task:1","type":"task.created"}"#,
            ),
            "bad_response",
        ),
        (
            bad(
                "task.created",
                r#"{"seq":5,"stream":"task:1","type":"Task Created"}"#,
            ),
            "bad_response",
        ),
        (
            bad(
                "task.created",
                &format!(r#"{{"seq":5,"stream":"task:1","type":"{SENTINEL}"}}"#),
            ),
            "bad_response",
        ),
    ] {
        let (got, end, _) = run("200 OK", sse, 64);
        assert_eq!(got, vec![Forwarded::Open, task(42, 1, "task.created")]);
        assert_eq!(end, reason);
    }
}

#[test]
fn un_rechazo_o_una_respuesta_que_no_es_sse_no_abre_el_stream() {
    assert_eq!(run("401 Unauthorized", String::new(), 8).1, "unauthorized");
    assert_eq!(
        run("500 Internal Server Error", String::new(), 8).1,
        "bad_response"
    );
}

#[test]
fn sin_credenciales_o_sin_socket_dice_por_que_sin_emitir_nada() {
    let mut got = Vec::new();
    assert_eq!(
        stream_at(&home(None), &mut |e| got.push(e)),
        "no_credentials"
    );
    assert_eq!(
        stream_at(&home(Some(SENTINEL)), &mut |e| got.push(e)),
        "no_socket"
    );
    assert!(got.is_empty());
}
