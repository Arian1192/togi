//! `read_plan` devuelve el plan vigente y nunca el token (ADR-005, ADR-010 §1, §3). El daemon falso
//! responde como el real (`Content-Length`, en trozos) y refleja el token a propósito en cabeceras,
//! cuerpos y campos que la app no usa; nada de lo que sale hacia el webview puede contenerlo.

use serde_json::{json, Value};
use std::io::{Read, Write};
use std::os::unix::net::UnixListener;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use togi_desktop_lib::plan::{plan_at, PlanRead};

const SENTINEL: &str = "tok-centinela-7f3a9c41";
static NEXT: AtomicUsize = AtomicUsize::new(0);

/// Un `TOGI_HOME` corto (la ruta de un socket Unix tiene un límite) con las credenciales.
fn home(token: Option<&str>) -> PathBuf {
    let n = NEXT.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("tp-{}-{n}", std::process::id()));
    std::fs::create_dir_all(dir.join("run")).unwrap();
    if let Some(token) = token {
        std::fs::write(dir.join("credentials"), format!("{token}\n")).unwrap();
    }
    dir
}

/// Daemon falso: lee la petición y responde `status` con `etag` y `body` en trozos de 7 bytes.
/// Devuelve la petición que recibió.
fn fake_daemon(home: &PathBuf, status: &str, etag: Option<&str>, body: String) -> JoinHandle<String> {
    let listener = UnixListener::bind(home.join("run").join("togi.sock")).unwrap();
    let (status, etag) = (status.to_owned(), etag.map(str::to_owned));
    thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = Vec::new();
        let mut byte = [0; 1];
        while !request.ends_with(b"\r\n\r\n") {
            stream.read_exact(&mut byte).unwrap();
            request.push(byte[0]);
        }
        let etag = etag.map(|e| format!("etag: {e}\r\n")).unwrap_or_default();
        let response = format!(
            "HTTP/1.1 {status}\r\ncontent-type: application/json\r\nx-echo: Bearer {SENTINEL}\r\n{etag}\
             content-length: {}\r\n\r\n{body}",
            body.len()
        );
        for part in response.as_bytes().chunks(7) {
            stream.write_all(part).unwrap();
            stream.flush().unwrap();
            thread::sleep(Duration::from_millis(1));
        }
        String::from_utf8(request).unwrap()
    })
}

/// Un plan como lo devuelve `GET /v1/tasks/:n/plan`, con campos que la vista no usa y el token reflejado.
fn plan_json(approach: &str) -> Value {
    json!({
        "planVersion": 2, "sessionId": SENTINEL, "baseSha": "abc123",
        "files": [{ "path": "src/a.ts", "change": "modify" }, { "path": "src/b.ts", "change": "add" }],
        "newTests": ["src/a.test.ts"], "estimatedLines": { "production": 10, "tests": 20 },
        "proposedAt": "2026-11-07T12:00:00.000Z", "approach": approach, "approachErased": false,
        "previous": [{ "planVersion": 1, "sessionId": SENTINEL }]
    })
}

/// Lee el plan de la tarea 12 de un daemon falso y devuelve el resultado y la petición recibida.
fn read(status: &str, etag: Option<&str>, body: String) -> (PlanRead, String) {
    let home = home(Some(SENTINEL));
    let daemon = fake_daemon(&home, status, etag, body);
    let plan = plan_at(&home, 12);
    (plan, daemon.join().unwrap())
}

/// El JSON que recibiría el webview; no puede contener el token.
fn clean(plan: &PlanRead) -> String {
    let json = serde_json::to_string(plan).unwrap();
    assert!(!json.contains(SENTINEL), "el plan contiene el token: {json}");
    json
}

fn reason(plan: &PlanRead) -> &'static str {
    match plan {
        PlanRead::Unreachable { reason } => reason,
        PlanRead::Ok { .. } => panic!("se esperaba un motivo: {plan:?}"),
    }
}

#[test]
fn read_plan_devuelve_el_plan_y_la_version_del_etag_sin_el_token_ni_campos_de_mas() {
    let (plan, request) = read("200 OK", Some("\"7\""), plan_json("hacer A\ny luego B").to_string());
    assert!(request.starts_with("GET /v1/tasks/12/plan HTTP/1.1\r\n"), "{request}");
    let PlanRead::Ok { plan: view, version } = &plan else { panic!("{plan:?}") };
    assert_eq!((view.plan_version, *version), (2, 7));
    assert_eq!(view.approach, "hacer A\ny luego B");
    assert_eq!(view.new_tests, ["src/a.test.ts"]);
    assert_eq!((view.estimated_lines.production, view.estimated_lines.tests), (10, 20));
    let json = clean(&plan);
    assert!(json.contains(r#""status":"ok""#) && json.contains(r#""version":7"#), "{json}");
    for extra in ["sessionId", "baseSha", "previous", "proposedAt"] {
        assert!(!json.contains(extra), "{extra} no debe llegar a la vista: {json}");
    }
}

#[test]
fn un_enfoque_con_html_llega_byte_a_byte_como_texto() {
    let approach = "<script>alert(1)</script><img src=x onerror=alert(2)>\n  &amp; <b>negrita</b> \u{1F600}";
    let (plan, _) = read("200 OK", Some("\"7\""), plan_json(approach).to_string());
    let PlanRead::Ok { plan: view, .. } = &plan else { panic!("{plan:?}") };
    assert_eq!(view.approach.as_bytes(), approach.as_bytes());
    let round: Value = serde_json::from_str(&clean(&plan)).unwrap();
    assert_eq!(round["plan"]["approach"], approach);
}

#[test]
fn un_plan_con_el_token_en_cualquier_texto_es_bad_response() {
    let mut in_approach = plan_json("enfoque");
    in_approach["approach"] = json!(format!("secreto {SENTINEL}"));
    let mut in_path = plan_json("enfoque");
    in_path["files"][0]["path"] = json!(format!("src/{SENTINEL}.ts"));
    let mut in_test = plan_json("enfoque");
    in_test["newTests"][0] = json!(SENTINEL);
    for body in [in_approach, in_path, in_test] {
        let (plan, _) = read("200 OK", Some("\"7\""), body.to_string());
        assert_eq!(reason(&plan), "bad_response");
        clean(&plan);
    }
}

#[test]
fn un_plan_fuera_de_contrato_o_sin_etag_valido_es_bad_response() {
    let etag = Some("\"7\"");
    let mut bad_change = plan_json("x");
    bad_change["files"][0]["change"] = json!("rename");
    let mut unsafe_lines = plan_json("x");
    unsafe_lines["estimatedLines"]["production"] = json!(1u64 << 53);
    let mut no_erased = plan_json("x");
    no_erased.as_object_mut().unwrap().remove("approachErased");
    for (etag, body) in [
        (etag, bad_change),
        (etag, unsafe_lines),
        (etag, no_erased),
        (None, plan_json("x")),
        (Some("\"abc\""), plan_json("x")),
        (Some("\"0\""), plan_json("x")),
    ] {
        let (plan, _) = read("200 OK", etag, body.to_string());
        assert_eq!(reason(&plan), "bad_response");
    }
}

#[test]
fn los_errores_del_daemon_son_motivos_cerrados_sin_su_texto() {
    for (status, expected) in [
        ("401 Unauthorized", "unauthorized"),
        ("404 Not Found", "not_found"),
        ("500 Oops", "bad_response"),
    ] {
        let (plan, _) = read(status, None, json!({ "title": SENTINEL }).to_string());
        assert_eq!(reason(&plan), expected);
        clean(&plan);
    }
}

#[test]
fn sin_credenciales_sin_socket_o_con_un_numero_invalido_no_se_intenta_nada() {
    assert_eq!(reason(&plan_at(&home(None), 12)), "no_credentials");
    let with_credentials = home(Some(SENTINEL));
    assert_eq!(reason(&plan_at(&with_credentials, 12)), "no_socket");
    for number in [0, 1 << 53] {
        assert_eq!(reason(&plan_at(&with_credentials, number)), "invalid_request");
    }
}

#[test]
fn el_comando_solo_acepta_el_numero_de_tarea() {
    let source = include_str!("../src/plan.rs");
    let rest = &source[source.find("pub async fn read_plan(").unwrap()..];
    assert!(rest.starts_with("pub async fn read_plan(number: u64) -> PlanRead"), "{rest}");
}
