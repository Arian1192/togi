//! `read_plan` devuelve el plan vigente y nunca el token (ADR-005, ADR-010 §1, §3). El daemon falso
//! responde como el real (`Content-Length`, en trozos) y refleja el token a propósito en cabeceras,
//! cuerpos y campos que la app no usa; nada de lo que sale hacia el webview puede contenerlo.

use serde_json::{json, Value};
use std::cell::RefCell;
use std::io::{ErrorKind, Read, Write};
use std::os::unix::net::UnixListener;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use togi_desktop_lib::plan::{
    decide_at, plan_at, Action, Confirm, Decision, PlanRead, Reason, CATEGORIES,
};

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
fn fake_daemon(home: &Path, status: &str, etag: Option<&str>, body: String) -> JoinHandle<String> {
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
    assert!(
        !json.contains(SENTINEL),
        "el plan contiene el token: {json}"
    );
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
    let (plan, request) = read(
        "200 OK",
        Some("\"7\""),
        plan_json("hacer A\ny luego B").to_string(),
    );
    assert!(
        request.starts_with("GET /v1/tasks/12/plan HTTP/1.1\r\n"),
        "{request}"
    );
    let PlanRead::Ok {
        plan: view,
        version,
    } = &plan
    else {
        panic!("{plan:?}")
    };
    assert_eq!((view.plan_version, *version), (2, 7));
    assert_eq!(view.approach, "hacer A\ny luego B");
    assert_eq!(view.new_tests, ["src/a.test.ts"]);
    assert_eq!(
        (view.estimated_lines.production, view.estimated_lines.tests),
        (10, 20)
    );
    let json = clean(&plan);
    assert!(
        json.contains(r#""status":"ok""#) && json.contains(r#""version":7"#),
        "{json}"
    );
    for extra in ["sessionId", "baseSha", "previous", "proposedAt"] {
        assert!(
            !json.contains(extra),
            "{extra} no debe llegar a la vista: {json}"
        );
    }
}

#[test]
fn un_enfoque_con_html_llega_byte_a_byte_como_texto() {
    let approach =
        "<script>alert(1)</script><img src=x onerror=alert(2)>\n  &amp; <b>negrita</b> \u{1F600}";
    let (plan, _) = read("200 OK", Some("\"7\""), plan_json(approach).to_string());
    let PlanRead::Ok { plan: view, .. } = &plan else {
        panic!("{plan:?}")
    };
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
        assert_eq!(
            reason(&plan_at(&with_credentials, number)),
            "invalid_request"
        );
    }
}

#[test]
fn el_comando_solo_acepta_el_numero_de_tarea() {
    let source = include_str!("../src/plan.rs");
    let rest = &source[source.find("pub async fn read_plan(").unwrap()..];
    assert!(
        rest.starts_with("pub async fn read_plan(number: u64) -> PlanRead"),
        "{rest}"
    );
}

// Decisiones sobre el plan: aprobar y rechazar piden confirmación con un diálogo nativo desde Rust
// (aquí, un doble) y sin confirmar no se llama al daemon; pedir cambios no la necesita.

/// Lo que recibió el daemon falso: la línea y cabeceras de la petición, y el cuerpo.
struct Seen {
    head: String,
    body: String,
}

/// Daemon falso para un POST: lee la petición con su cuerpo y responde en trozos de 5 bytes.
fn post_daemon(home: &Path, status: &str) -> JoinHandle<Seen> {
    let listener = UnixListener::bind(home.join("run").join("togi.sock")).unwrap();
    let status = status.to_owned();
    thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut head = Vec::new();
        let mut byte = [0; 1];
        while !head.ends_with(b"\r\n\r\n") {
            stream.read_exact(&mut byte).unwrap();
            head.push(byte[0]);
        }
        let head = String::from_utf8(head).unwrap();
        let length = head
            .lines()
            .find_map(|l| {
                l.to_lowercase()
                    .strip_prefix("content-length:")
                    .map(|v| v.trim().parse().unwrap())
            })
            .unwrap_or(0);
        let mut sent = vec![0; length];
        stream.read_exact(&mut sent).unwrap();
        let body = json!({ "number": 12, "state": "building", "echo": SENTINEL }).to_string();
        let response = format!(
            "HTTP/1.1 {status}\r\ncontent-type: application/json\r\nx-echo: Bearer {SENTINEL}\r\n\
             content-length: {}\r\n\r\n{body}",
            body.len()
        );
        for part in response.as_bytes().chunks(5) {
            stream.write_all(part).unwrap();
            stream.flush().unwrap();
            thread::sleep(Duration::from_millis(1));
        }
        Seen {
            head,
            body: String::from_utf8(sent).unwrap(),
        }
    })
}

/// Doble de la confirmación: contesta `yes` y guarda las preguntas.
struct Answer {
    yes: bool,
    asked: RefCell<Vec<String>>,
}

impl Answer {
    fn new(yes: bool) -> Answer {
        Answer {
            yes,
            asked: RefCell::new(Vec::new()),
        }
    }
}

impl Confirm for Answer {
    fn ask(&self, question: &str) -> bool {
        self.asked.borrow_mut().push(question.to_owned());
        self.yes
    }
}

fn scope(text: &str) -> Reason {
    Reason::new("scope", text).unwrap()
}

/// Decide sobre la tarea 12 con el plan visto en la versión 7 contra un daemon falso que responde `status`.
fn decide(status: &str, action: &Action, confirm: &Answer) -> (Decision, Seen) {
    let home = home(Some(SENTINEL));
    let daemon = post_daemon(&home, status);
    let decision = decide_at(&home, 12, 7, action, confirm);
    (decision, daemon.join().unwrap())
}

/// El JSON que recibiría el webview; no puede contener el token.
fn clean_json<T: serde::Serialize>(value: &T) -> String {
    let json = serde_json::to_string(value).unwrap();
    assert!(
        !json.contains(SENTINEL),
        "lo que sale hacia el webview contiene el token: {json}"
    );
    json
}

#[test]
fn aprobar_confirma_y_manda_post_con_if_match_de_la_version_vista() {
    let confirm = Answer::new(true);
    let (decision, seen) = decide("200 OK", &Action::Approve, &confirm);
    assert_eq!(decision, Decision::Ok);
    assert!(
        seen.head
            .starts_with("POST /v1/tasks/12/plan/approve HTTP/1.1\r\n"),
        "{}",
        seen.head
    );
    assert!(seen.head.contains("If-Match: \"7\"\r\n"), "{}", seen.head);
    assert_eq!(seen.body, "");
    assert_eq!(confirm.asked.borrow().len(), 1);
    assert!(
        confirm.asked.borrow()[0].contains("tarea 12"),
        "{:?}",
        confirm.asked
    );
    assert_eq!(clean_json(&decision), r#"{"status":"ok"}"#);
}

#[test]
fn pedir_cambios_manda_el_motivo_recortado_y_no_pide_confirmacion() {
    let confirm = Answer::new(false);
    let action = Action::RequestChanges(Reason::new("tests", "  faltan casos  ").unwrap());
    let (decision, seen) = decide("200 OK", &action, &confirm);
    assert_eq!(decision, Decision::Ok);
    assert!(
        seen.head
            .starts_with("POST /v1/tasks/12/plan/request-changes HTTP/1.1\r\n"),
        "{}",
        seen.head
    );
    assert!(seen.head.contains("If-Match: \"7\"\r\n"), "{}", seen.head);
    let body: Value = serde_json::from_str(&seen.body).unwrap();
    assert_eq!(
        body,
        json!({ "reason": { "category": "tests", "text": "faltan casos" } })
    );
    assert!(confirm.asked.borrow().is_empty());
}

#[test]
fn rechazar_confirmado_manda_post_con_if_match_y_el_motivo() {
    let confirm = Answer::new(true);
    let (decision, seen) = decide(
        "200 OK",
        &Action::Reject(scope("fuera de alcance")),
        &confirm,
    );
    assert_eq!(decision, Decision::Ok);
    assert!(
        seen.head
            .starts_with("POST /v1/tasks/12/plan/reject HTTP/1.1\r\n"),
        "{}",
        seen.head
    );
    assert!(seen.head.contains("If-Match: \"7\"\r\n"), "{}", seen.head);
    let body: Value = serde_json::from_str(&seen.body).unwrap();
    assert_eq!(
        body,
        json!({ "reason": { "category": "scope", "text": "fuera de alcance" } })
    );
    assert_eq!(confirm.asked.borrow().len(), 1);
}

#[test]
fn si_no_se_confirma_no_se_llama_al_daemon() {
    for action in [Action::Approve, Action::Reject(scope("no"))] {
        let home = home(Some(SENTINEL));
        let listener = UnixListener::bind(home.join("run").join("togi.sock")).unwrap();
        listener.set_nonblocking(true).unwrap();
        let confirm = Answer::new(false);
        let decision = decide_at(&home, 12, 7, &action, &confirm);
        assert_eq!(decision, Decision::Cancelled);
        assert_eq!(confirm.asked.borrow().len(), 1);
        let accepted = listener.accept();
        assert!(
            matches!(accepted, Err(ref e) if e.kind() == ErrorKind::WouldBlock),
            "el daemon recibió una llamada"
        );
        assert_eq!(clean_json(&decision), r#"{"status":"cancelled"}"#);
    }
}

#[test]
fn un_412_es_plan_changed_en_las_tres_decisiones_y_no_se_reintenta() {
    for action in [
        Action::Approve,
        Action::RequestChanges(scope("x")),
        Action::Reject(scope("x")),
    ] {
        let (decision, _) = decide("412 Precondition Failed", &action, &Answer::new(true));
        assert_eq!(decision, Decision::PlanChanged);
        assert_eq!(clean_json(&decision), r#"{"status":"plan_changed"}"#);
    }
}

#[test]
fn otros_codigos_son_motivos_cerrados_sin_el_texto_del_daemon() {
    for (status, expected) in [
        ("401 Unauthorized", "unauthorized"),
        ("404 Not Found", "not_found"),
        ("409 Conflict", "conflict"),
        ("428 Precondition Required", "bad_response"),
        ("500 Oops", "bad_response"),
    ] {
        let (decision, _) = decide(
            status,
            &Action::RequestChanges(scope("x")),
            &Answer::new(true),
        );
        assert_eq!(decision, Decision::Failed { reason: expected });
        clean_json(&decision);
    }
}

#[test]
fn sin_credenciales_o_con_numeros_invalidos_no_se_pregunta_ni_se_llama() {
    let confirm = Answer::new(true);
    let none = home(None);
    let no_credentials = decide_at(&none, 12, 7, &Action::Approve, &confirm);
    assert_eq!(
        no_credentials,
        Decision::Failed {
            reason: "no_credentials"
        }
    );
    let some = home(Some(SENTINEL));
    for (number, version) in [(0, 7), (12, 0), (1 << 53, 7), (12, 1 << 53)] {
        let decision = decide_at(&some, number, version, &Action::Approve, &confirm);
        assert_eq!(
            decision,
            Decision::Failed {
                reason: "invalid_request"
            }
        );
    }
    assert!(confirm.asked.borrow().is_empty());
}

#[test]
fn el_motivo_exige_categoria_de_la_lista_cerrada_y_texto_no_vacio_y_acotado() {
    assert!(Reason::new("nope", "x").is_none());
    assert!(Reason::new("", "x").is_none());
    assert!(Reason::new("scope", " \n\t ").is_none());
    assert!(Reason::new("scope", &"a".repeat(5_000)).is_some());
    assert!(Reason::new("scope", &"a".repeat(5_001)).is_none());
    // El daemon cuenta unidades UTF-16: cada emoji son dos.
    assert!(Reason::new("scope", &"\u{1F600}".repeat(2_500)).is_some());
    assert!(Reason::new("scope", &"\u{1F600}".repeat(2_501)).is_none());
}

#[test]
fn las_categorias_son_las_de_core() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../core/src/model/task.ts");
    let source = std::fs::read_to_string(path).unwrap();
    let list = source
        .split("REASON_CATEGORIES = [")
        .nth(1)
        .unwrap()
        .split("] as const")
        .next()
        .unwrap();
    let core: Vec<&str> = list.split('"').skip(1).step_by(2).collect();
    assert_eq!(CATEGORIES.to_vec(), core);
}

#[test]
fn los_comandos_de_decision_solo_aceptan_numero_version_categoria_y_motivo() {
    let source = include_str!("../src/plan.rs");
    let params = |name: &str| -> Vec<String> {
        let rest = &source[source.find(&format!("pub async fn {name}(")).unwrap()..];
        let args = &rest[rest.find('(').unwrap() + 1..rest.find(')').unwrap()];
        let names = args.split(',').filter(|a| !a.trim().is_empty());
        names
            .map(|a| a.split(':').next().unwrap().trim().to_owned())
            .collect()
    };
    assert_eq!(params("approve_plan"), ["app", "number", "version"]);
    assert_eq!(
        params("request_plan_changes"),
        ["app", "number", "version", "category", "text"]
    );
    assert_eq!(
        params("reject_plan"),
        ["app", "number", "version", "category", "text"]
    );
}
