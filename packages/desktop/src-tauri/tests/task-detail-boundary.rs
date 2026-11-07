//! `read_task` devuelve lo que pinta la portada del cuaderno y nunca el token (ADR-005, ADR-010 §1).
//! El daemon falso responde como el real (`Content-Length`, en trozos) y refleja el token a propósito
//! en cabeceras, cuerpos y campos que la app no usa.

use serde_json::{json, Value};
use std::io::{Read, Write};
use std::os::unix::net::UnixListener;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use togi_desktop_lib::tasks::{task_at, TaskRead};

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

/// Daemon falso: lee la petición y responde `status` con `body` en trozos de 9 bytes.
fn fake_daemon(home: &Path, status: &str, body: String) -> JoinHandle<String> {
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
        for part in response.as_bytes().chunks(9) {
            stream.write_all(part).unwrap();
            stream.flush().unwrap();
            thread::sleep(Duration::from_millis(1));
        }
        String::from_utf8(request).unwrap()
    })
}

/// Una tarea como la devuelve `GET /v1/tasks/:n`, con campos que la portada no usa y el token reflejado.
fn task_json() -> Value {
    json!({
        "number": 12, "title": "Añadir filtro por fecha", "titleErased": false, "state": "plan_review",
        "risk": "low", "repo": "arian1192/togi", "baseBranch": "main",
        "createdAt": "2026-11-06T09:00:00.000Z", "updatedAt": "2026-11-07T12:00:00.000Z",
        "version": 7, "planVersion": 2, "description": SENTINEL,
        "acceptanceCriteria": "El filtro acepta un rango.", "erased": { "description": false, "acceptanceCriteria": false }
    })
}

fn read(status: &str, body: String) -> (TaskRead, String) {
    let home = home(Some(SENTINEL));
    let daemon = fake_daemon(&home, status, body);
    let task = task_at(&home, 12);
    (task, daemon.join().unwrap())
}

/// El JSON que recibiría el webview; no puede contener el token.
fn clean(task: &TaskRead) -> String {
    let json = serde_json::to_string(task).unwrap();
    assert!(
        !json.contains(SENTINEL),
        "el detalle contiene el token: {json}"
    );
    json
}

fn reason(task: &TaskRead) -> &'static str {
    match task {
        TaskRead::Unreachable { reason } => reason,
        TaskRead::Ok { .. } => panic!("se esperaba un motivo: {task:?}"),
    }
}

#[test]
fn read_task_devuelve_la_portada_sin_el_token_ni_campos_de_mas() {
    let (task, request) = read("200 OK", task_json().to_string());
    assert!(
        request.starts_with("GET /v1/tasks/12 HTTP/1.1\r\n"),
        "{request}"
    );
    let TaskRead::Ok { task: t } = &task else {
        panic!("{task:?}")
    };
    assert_eq!((t.number, t.version, t.plan_version), (12, 7, Some(2)));
    assert_eq!(
        (t.title.as_deref(), t.risk.as_str(), t.repo.as_str()),
        (Some("Añadir filtro por fecha"), "low", "arian1192/togi")
    );
    assert_eq!(
        (t.state.as_str(), t.base_branch.as_str()),
        ("plan_review", "main")
    );
    assert_eq!(t.criteria.as_deref(), Some("El filtro acepta un rango."));
    let json = clean(&task);
    for extra in ["description", "createdAt", "updatedAt"] {
        assert!(
            !json.contains(extra),
            "{extra} no debe llegar a la vista: {json}"
        );
    }
}

#[test]
fn el_criterio_llega_como_texto_y_el_titulo_en_una_linea() {
    let mut body = task_json();
    body["acceptanceCriteria"] = json!("<script>alert(1)</script>\n  - uno &amp; <b>dos</b>");
    body["title"] = json!("  Un\ttítulo\ncon <img onerror=x> saltos  ");
    let (task, _) = read("200 OK", body.to_string());
    let TaskRead::Ok { task: t } = &task else {
        panic!("{task:?}")
    };
    assert_eq!(
        t.criteria.as_deref(),
        Some("<script>alert(1)</script>\n  - uno &amp; <b>dos</b>")
    );
    assert_eq!(
        t.title.as_deref(),
        Some("Un título con <img onerror=x> saltos")
    );
}

#[test]
fn un_titulo_o_criterio_borrado_sale_nulo_con_su_marca() {
    let mut body = task_json();
    body["title"] = Value::Null;
    body["titleErased"] = json!(true);
    body["acceptanceCriteria"] = Value::Null;
    body["erased"]["acceptanceCriteria"] = json!(true);
    body["planVersion"] = Value::Null;
    let (task, _) = read("200 OK", body.to_string());
    let TaskRead::Ok { task: t } = &task else {
        panic!("{task:?}")
    };
    assert_eq!(
        (
            &t.title,
            t.title_erased,
            &t.criteria,
            t.criteria_erased,
            t.plan_version
        ),
        (&None, true, &None, true, None)
    );
    clean(&task);
}

#[test]
fn con_el_token_en_un_texto_o_fuera_de_contrato_es_bad_response() {
    let with = |field: &str, value: Value| {
        let mut body = task_json();
        body[field] = value;
        body
    };
    for body in [
        with("title", json!(format!("t {SENTINEL}"))),
        with("acceptanceCriteria", json!(format!("c {SENTINEL}"))),
        with("repo", json!(SENTINEL)),
        with("baseBranch", json!(format!("b-{SENTINEL}"))),
        with("risk", json!("extreme")),
        with("repo", json!("sin barra")),
        with("number", json!(13)),
        with("version", json!(0)),
        with("planVersion", json!(1u64 << 53)),
        with("state", json!("Plan Review")),
    ] {
        let (task, _) = read("200 OK", body.to_string());
        assert_eq!(reason(&task), "bad_response", "{body}");
        clean(&task);
    }
}

#[test]
fn los_errores_son_motivos_cerrados_y_sin_datos_no_se_intenta_nada() {
    for (status, expected) in [
        ("401 Unauthorized", "unauthorized"),
        ("404 Not Found", "not_found"),
        ("500 Oops", "bad_response"),
    ] {
        let (task, _) = read(status, json!({ "title": SENTINEL }).to_string());
        assert_eq!(reason(&task), expected);
        clean(&task);
    }
    assert_eq!(reason(&task_at(&home(None), 12)), "no_credentials");
    let with_credentials = home(Some(SENTINEL));
    assert_eq!(reason(&task_at(&with_credentials, 12)), "no_socket");
    for number in [0, 1 << 53] {
        assert_eq!(
            reason(&task_at(&with_credentials, number)),
            "invalid_request"
        );
    }
}

#[test]
fn el_comando_solo_acepta_el_numero_de_tarea() {
    let source = include_str!("../src/tasks.rs");
    let rest = &source[source.find("pub async fn read_task(").unwrap()..];
    assert!(
        rest.starts_with("pub async fn read_task(number: u64) -> TaskRead"),
        "{rest}"
    );
}
