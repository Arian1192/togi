//! `list_tasks` devuelve solo lo que pinta una fila y nunca el token (ADR-005, ADR-010 §1). El daemon
//! falso responde como el real (`Content-Length`, en trozos) y refleja el token a propósito en las
//! cabeceras, en el cuerpo y en campos de cada tarea que la app no usa.

use serde_json::{json, Value};
use std::io::{Read, Write};
use std::os::unix::net::UnixListener;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use togi_desktop_lib::tasks::{tasks_at, TaskList};

const SENTINEL: &str = "tok-centinela-7f3a9c41";
static NEXT: AtomicUsize = AtomicUsize::new(0);

/// Un `TOGI_HOME` corto (la ruta de un socket Unix tiene un límite) con las credenciales.
fn home(token: Option<&str>) -> PathBuf {
    let n = NEXT.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("tt-{}-{n}", std::process::id()));
    std::fs::create_dir_all(dir.join("run")).unwrap();
    if let Some(token) = token {
        std::fs::write(dir.join("credentials"), format!("{token}\n")).unwrap();
    }
    dir
}

/// Daemon falso: lee la petición y responde `status` con `body` en trozos de `chunk` bytes.
/// Devuelve la petición que recibió.
fn fake_daemon(home: &Path, status: &str, body: String, chunk: usize) -> JoinHandle<String> {
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
        for part in response.as_bytes().chunks(chunk) {
            stream.write_all(part).unwrap();
            stream.flush().unwrap();
            thread::sleep(Duration::from_millis(1));
        }
        String::from_utf8(request).unwrap()
    })
}

/// Una tarea como la devuelve `GET /v1/tasks`, con campos que la fila no usa y el token reflejado.
fn task(number: u64, state: &str, title: &str) -> Value {
    json!({
        "number": number, "title": title, "titleErased": false, "state": state, "risk": "low",
        "repo": "arian1192/togi", "baseBranch": "main", "description": SENTINEL, "hasCriteria": true,
        "updatedAt": "2026-11-07T12:00:00.000Z", "version": 3
    })
}

fn tasks_body(tasks: Vec<Value>) -> String {
    json!({ "tasks": tasks, "echo": SENTINEL }).to_string()
}

/// Pide la lista a un daemon falso y devuelve la respuesta y la petición recibida.
fn ask(status: &str, body: String, chunk: usize) -> (TaskList, String) {
    let home = home(Some(SENTINEL));
    let daemon = fake_daemon(&home, status, body, chunk);
    let list = tasks_at(&home);
    (list, daemon.join().unwrap())
}

/// El JSON que recibiría el webview; no puede contener el token.
fn clean(list: &TaskList) -> String {
    let json = serde_json::to_string(list).unwrap();
    assert!(
        !json.contains(SENTINEL),
        "la lista contiene el token: {json}"
    );
    json
}

fn titles(list: &TaskList) -> Vec<Option<String>> {
    match list {
        TaskList::Ok { tasks, .. } => tasks.iter().map(|t| t.title.clone()).collect(),
        TaskList::Unreachable { reason } => panic!("sin lista: {reason}"),
    }
}

#[test]
fn la_lista_trae_solo_los_campos_de_la_fila_y_nunca_el_token() {
    let body = tasks_body(vec![task(1, "draft", "Uno"), task(2, "planning", "Dos")]);
    let (list, request) = ask("200 OK", body, 7);
    assert!(
        request.starts_with("GET /v1/tasks?limit=200 HTTP/1.1\r\n"),
        "{request}"
    );
    assert!(request.contains(&format!("Authorization: Bearer {SENTINEL}\r\n")));
    let row = |n: u64, title: &str, state: &str| {
        format!(
            r#"{{"number":{n},"title":"{title}","titleErased":false,"state":"{state}","repo":"arian1192/togi","baseBranch":"main","hasCriteria":true,"updatedAt":"2026-11-07T12:00:00.000Z","version":3}}"#
        )
    };
    let expected = format!(
        r#"{{"status":"ok","tasks":[{},{}],"truncated":false}}"#,
        row(1, "Uno", "draft"),
        row(2, "Dos", "planning")
    );
    assert_eq!(clean(&list), expected);
}

#[test]
fn un_titulo_borrado_sale_nulo_y_un_titulo_largo_o_con_control_sale_en_una_linea_recortado() {
    let mut erased = task(1, "draft", "");
    erased["title"] = Value::Null;
    erased["titleErased"] = json!(true);
    let long = "é".repeat(500);
    let body = tasks_body(vec![
        erased,
        task(2, "draft", "línea 1\nlínea 2\t\u{0}\u{1b}[31mfin\r\n"),
        task(3, "draft", &long),
    ]);
    let (list, _) = ask("200 OK", body, 4096);
    clean(&list);
    let titles = titles(&list);
    assert_eq!(titles[0], None);
    assert_eq!(titles[1].as_deref(), Some("línea 1 línea 2 [31mfin"));
    assert_eq!(titles[2].as_ref().map(|t| t.chars().count()), Some(120));
}

#[test]
fn con_200_tareas_hay_truncado_y_con_199_no_aunque_pase_de_64_kib() {
    // Títulos de 120 caracteres acentuados (2 bytes cada uno): el cuerpo pasa de 64 KiB.
    let rows = |n: u64| {
        (1..=n)
            .map(|i| task(i, "building", &"é".repeat(120)))
            .collect::<Vec<_>>()
    };
    let full = tasks_body(rows(200));
    assert!(full.len() > 64 * 1024, "el cuerpo mide {}", full.len());
    let (list, _) = ask("200 OK", full, 8192);
    match &clean(&list) {
        json if json.ends_with(r#""truncated":true}"#) => {}
        json => panic!("debía estar truncada: {}", &json[json.len() - 40..]),
    }
    let (list, _) = ask("200 OK", tasks_body(rows(199)), 8192);
    assert!(clean(&list).ends_with(r#""truncated":false}"#));
}

#[test]
fn daemon_caido_401_o_respuesta_no_valida_dan_un_motivo_cerrado_sin_texto_del_daemon() {
    let reflected = |code: &str, body: &str| ask(code, body.to_owned(), 7).0;
    let bad = r#"{"status":"unreachable","reason":"bad_response"}"#;
    let cases: Vec<(TaskList, &str)> = vec![
        (
            reflected("401 Unauthorized", &format!(r#"{{"detail":"{SENTINEL}"}}"#)),
            r#"{"status":"unreachable","reason":"unauthorized"}"#,
        ),
        (reflected("500 Internal Server Error", SENTINEL), bad),
        (reflected("200 OK", &format!("no es json {SENTINEL}")), bad),
        (
            reflected("200 OK", &json!({ "tasks": SENTINEL }).to_string()),
            bad,
        ),
        // Un solo dato fuera de contrato invalida toda la lista: nunca una lista a medias.
        (
            reflected("200 OK", &tasks_body(vec![task(1, "Plan_Review", "x")])),
            bad,
        ),
        (
            reflected("200 OK", &tasks_body(vec![task(0, "draft", "x")])),
            bad,
        ),
        (
            reflected("200 OK", &tasks_body(vec![task(1, "draft", SENTINEL)])),
            bad,
        ),
        (
            reflected("200 OK", &tasks_body(vec![json!({ "number": 1 })])),
            bad,
        ),
    ];
    for (list, expected) in &cases {
        assert_eq!(clean(list), *expected);
    }
}

#[test]
fn sin_socket_o_sin_credenciales_no_se_intenta_nada() {
    let sin_socket = home(Some(SENTINEL));
    assert_eq!(
        clean(&tasks_at(&sin_socket)),
        r#"{"status":"unreachable","reason":"no_socket"}"#
    );
    assert_eq!(
        clean(&tasks_at(&home(None))),
        r#"{"status":"unreachable","reason":"no_credentials"}"#
    );
}
