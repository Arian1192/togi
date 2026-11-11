//! `read_task_activity` da campos cerrados y nunca el token, un blob, un texto libre ni un id de
//! usuario (ADR-010 §3 y §8). El daemon falso responde en trozos y refleja el token a propósito.

use serde_json::{json, Value};
use std::io::{Read, Write};
use std::os::unix::net::UnixListener;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use togi_desktop_lib::activity::{
    activity_at, ActivityRead, GATE_STATUSES, MAX_ITEMS, OUTCOMES, ROLES, TYPES,
};

const SENTINEL: &str = "tok-centinela-7f3a9c41";
const SHA: &str = "0123456789abcdef0123456789abcdef01234567";
const AT: &str = "2026-11-11T10:00:00.000Z";
static NEXT: AtomicUsize = AtomicUsize::new(0);

fn home(token: Option<&str>) -> PathBuf {
    let n = NEXT.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("ta-{}-{n}", std::process::id()));
    std::fs::create_dir_all(dir.join("run")).unwrap();
    if let Some(token) = token {
        std::fs::write(dir.join("credentials"), format!("{token}\n")).unwrap();
    }
    dir
}

/// Daemon falso: atiende una conexión y devuelve la petición recibida.
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
        for part in response.as_bytes().chunks(4096) {
            // El cliente puede cortar antes de leerlo todo (cuerpo mayor que su límite).
            if stream.write_all(part).is_err() {
                break;
            }
            thread::sleep(Duration::from_millis(1));
        }
        String::from_utf8(request).unwrap()
    })
}

fn read(status: &str, body: String) -> (ActivityRead, String) {
    let home = home(Some(SENTINEL));
    let daemon = fake_daemon(&home, status, body);
    let result = activity_at(&home, 12);
    (result, daemon.join().unwrap())
}

/// La respuesta de la ruta con `list`; a cada evento le completa el sobre que la app no usa.
fn events(list: Vec<Value>) -> String {
    let full = list.into_iter().map(|e| {
        let mut full = json!({ "stream": "task:12", "schemaVersion": 1, "at": AT, "payload": {} });
        full.as_object_mut()
            .unwrap()
            .extend(e.as_object().unwrap().clone());
        full
    });
    json!({ "events": full.collect::<Vec<_>>() }).to_string()
}

fn human() -> Value {
    json!({ "kind": "human", "userId": "usr_secreto" })
}

fn system(component: &str) -> Value {
    json!({ "kind": "system", "component": component })
}

fn blob() -> Value {
    json!({ "keyId": "key_1", "hash": "hmac-sha256:abc", "secret": "texto secreto" })
}

fn items(result: &ActivityRead) -> (&Vec<Value>, bool) {
    match result {
        ActivityRead::Ok { items, truncated } => (items, *truncated),
        other => panic!("se esperaba ok: {other:?}"),
    }
}

fn reason(result: &ActivityRead) -> &'static str {
    match result {
        ActivityRead::Unreachable { reason } => reason,
        other => panic!("se esperaba unreachable: {other:?}"),
    }
}

fn story() -> Vec<Value> {
    vec![
        json!({ "seq": 1, "type": "task.created", "actor": human(), "payload": { "title": blob(), "repo": "o/r" } }),
        json!({ "seq": 2, "type": "task.submitted", "actor": human() }),
        json!({ "seq": 3, "type": "session.started", "actor": system("catalog"), "payload": {
            "sessionId": "ses_p1", "role": "planner", "cycle": null,
            "runtime": { "id": "claude-code", "version": "2.1.0" }, "model": "claude-opus-5-5",
            "specialist": { "id": "generic-planner", "version": 2, "hash": "sha256:x" },
            "workspaceId": null, "prompt": blob(), "policy": blob() } }),
        json!({ "seq": 4, "type": "plan.proposed", "actor": { "kind": "agent", "sessionId": "ses_p1", "role": "planner" },
            "payload": { "approach": blob(), "files": [{ "path": "texto secreto" }] } }),
        json!({ "seq": 5, "type": "session.ended", "actor": system("catalog"), "payload": {
            "sessionId": "ses_p1", "outcome": "completed", "trajectoryEvents": 9, "failureReason": null,
            "usage": { "inputTokens": 10, "outputTokens": 20, "estimatedCostUsd": 0.5, "durationMs": 300 } } }),
        json!({ "seq": 6, "type": "decision.recorded", "actor": human(), "payload": { "verdict": "approve" } }),
        json!({ "seq": 7, "type": "algo.futuro", "actor": human(), "payload": { "texto": "texto secreto" } }),
        json!({ "seq": 8, "type": "build.submitted", "actor": system("integrator"),
            "payload": { "cycle": 1, "headSha": SHA } }),
        json!({ "seq": 9, "type": "gate.completed", "actor": system("gates"), "payload": {
            "gateRunId": "gr_1", "cycle": 1, "headSha": SHA, "gate": "lint", "status": "fail",
            "summary": "texto secreto", "evidence": blob(), "durationMs": 42 } }),
        json!({ "seq": 10, "type": "verification.completed", "actor": system("gates"),
            "payload": { "cycle": 1, "headSha": SHA, "passed": false } }),
        json!({ "seq": 11, "type": "task.failed", "actor": system("gates"),
            "payload": { "cycle": 3, "failedGates": ["gr_1"] } }),
    ]
}

#[test]
fn la_historia_sale_en_orden_con_campos_cerrados_y_sin_texto_libre() {
    let (result, request) = read("200 OK", events(story()));
    assert!(request.starts_with("GET /v1/tasks/12/events HTTP/1.1\r\n"));
    let json = serde_json::to_string(&result).unwrap();
    let leaks = "texto secreto|usr_|hmac|keyId|summary|evidence|prompt|approach";
    for leak in leaks.split('|').chain([SENTINEL]) {
        assert!(!json.contains(leak), "la respuesta contiene {leak}: {json}");
    }
    let (items, truncated) = items(&result);
    assert!(!truncated);
    let seqs: Vec<u64> = items.iter().map(|i| i["seq"].as_u64().unwrap()).collect();
    assert_eq!(
        seqs,
        [1, 2, 3, 4, 5, 6, 8, 9, 10, 11],
        "el tipo desconocido se salta"
    );
    assert_eq!(
        items[0],
        json!({ "seq": 1, "at": AT, "type": "task.created", "actor": { "kind": "human" } })
    );
    assert_eq!(
        items[2],
        json!({ "seq": 3, "at": AT, "type": "session.started", "actor": { "kind": "system", "component": "catalog" },
                "role": "planner", "specialist": "generic-planner@2", "runtime": "claude-code@2.1.0",
                "model": "claude-opus-5-5", "sessionId": "ses_p1" })
    );
    assert_eq!(
        items[3]["actor"],
        json!({ "kind": "agent", "role": "planner" })
    );
    assert!(items[3].get("from").is_none() && items[3].get("to").is_none());
    assert_eq!(
        items[4],
        json!({ "seq": 5, "at": AT, "type": "session.ended", "actor": { "kind": "system", "component": "catalog" },
                "sessionId": "ses_p1", "outcome": "completed", "failureReason": null,
                "usage": { "durationMs": 300, "inputTokens": 10, "outputTokens": 20, "estimatedCostUsd": 0.5 } })
    );
    assert_eq!(
        items[5],
        json!({ "seq": 6, "at": AT, "type": "decision.recorded", "actor": { "kind": "human" }, "verdict": "approve" })
    );
    assert_eq!(
        items[6],
        json!({ "seq": 8, "at": AT, "type": "build.submitted", "actor": { "kind": "system", "component": "integrator" },
                "cycle": 1, "headSha": "0123456" })
    );
    assert_eq!(
        items[7],
        json!({ "seq": 9, "at": AT, "type": "gate.completed", "actor": { "kind": "system", "component": "gates" },
                "gate": "lint", "status": "fail", "cycle": 1, "durationMs": 42 })
    );
    assert_eq!(
        items[8],
        json!({ "seq": 10, "at": AT, "type": "verification.completed", "actor": { "kind": "system", "component": "gates" },
                "cycle": 1, "headSha": "0123456", "passed": false })
    );
    assert_eq!(items[9]["cycle"], 3);
}

#[test]
fn un_dato_fuera_de_contrato_o_con_el_token_invalida_la_respuesta() {
    let started = |model: &str| {
        json!({ "seq": 1, "type": "session.started", "actor": system("catalog"), "payload": {
            "sessionId": "ses_1", "role": "builder", "runtime": { "id": "r", "version": "1" },
            "model": model, "specialist": { "id": "s", "version": 1 } } })
    };
    let gate = |gate: &str, status: &str| {
        json!({ "seq": 1, "type": "gate.completed", "actor": system("gates"),
            "payload": { "gate": gate, "status": status, "cycle": 1, "durationMs": 1 } })
    };
    let submitted =
        |seq: u64, actor: Value| json!({ "seq": seq, "type": "task.submitted", "actor": actor });
    let cases = [
        vec![started(SENTINEL)],
        vec![started("modelo con espacios")],
        vec![gate("Lint!", "fail")],
        vec![gate("lint", "raro")],
        vec![
            json!({ "seq": 1, "type": "build.submitted", "actor": system("integrator"),
            "payload": { "cycle": 1, "headSha": "no-hex" } }),
        ],
        vec![submitted(1, json!({ "kind": "agent", "role": "jefe" }))],
        vec![submitted(1, system("adapter:con espacios"))],
        vec![submitted(2, human()), submitted(2, human())],
        vec![json!({ "seq": 1, "type": "task.submitted", "actor": human(), "at": "ayer" })],
    ];
    for case in cases {
        let (result, _) = read("200 OK", events(case.clone()));
        assert_eq!(reason(&result), "bad_response", "{case:?}");
    }
    let (result, _) = read("200 OK", "no es json".to_owned());
    assert_eq!(reason(&result), "bad_response");
}

#[test]
fn un_adaptador_y_un_motivo_de_fallo_salen_como_codigos() {
    let ended = json!({ "sessionId": "ses_b1", "outcome": "failed", "failureReason": "agent_failed",
        "trajectoryEvents": 1, "usage": { "inputTokens": 1, "outputTokens": 1, "estimatedCostUsd": 0, "durationMs": 1 } });
    let e = json!({ "seq": 1, "type": "session.ended", "actor": system("adapter:gh"), "payload": ended });
    let (result, _) = read("200 OK", events(vec![e]));
    let (items, _) = items(&result);
    assert_eq!(items[0]["actor"]["component"], "adapter:gh");
    assert_eq!(items[0]["failureReason"], "agent_failed");
}

#[test]
fn mas_de_max_items_movimientos_se_quedan_los_recientes_y_marcan_truncated() {
    let edited = |n| json!({ "seq": n, "type": "task.edited", "actor": human() });
    let list = (1..=MAX_ITEMS as u64 + 5).map(edited).collect();
    let (result, _) = read("200 OK", events(list));
    let (items, truncated) = items(&result);
    assert!(truncated);
    assert_eq!(items.len(), MAX_ITEMS);
    assert_eq!(items[0]["seq"], 6);
    assert_eq!(items.last().unwrap()["seq"], MAX_ITEMS as u64 + 5);
}

#[test]
fn un_cuerpo_mayor_que_el_maximo_es_bad_response() {
    let filler = "x".repeat(5 * 1024 * 1024);
    let e =
        json!({ "seq": 1, "type": "task.created", "actor": human(), "payload": { "f": filler } });
    let (result, _) = read("200 OK", events(vec![e]));
    assert_eq!(reason(&result), "bad_response");
}

#[test]
fn los_errores_del_daemon_son_motivos_cerrados_sin_su_texto() {
    let body = json!({ "code": "task_not_found", "detail": SENTINEL }).to_string();
    let (result, _) = read("404 Not Found", body.clone());
    assert_eq!(reason(&result), "not_found");
    let (result, _) = read("401 Unauthorized", body.clone());
    assert_eq!(reason(&result), "unauthorized");
    let (result, _) = read("500 Internal Server Error", body);
    assert_eq!(reason(&result), "bad_response");
}

#[test]
fn sin_daemon_o_con_numero_invalido_no_hay_peticion() {
    let home = home(Some(SENTINEL));
    assert_eq!(reason(&activity_at(&home, 0)), "invalid_request");
    assert_eq!(reason(&activity_at(&home, 1 << 53)), "invalid_request");
    assert_eq!(reason(&activity_at(&home, 1)), "no_socket");
    assert_eq!(reason(&activity_at(&self::home(None), 1)), "no_credentials");
}

/// Lo que hay en `file` de core entre `from` y `to`, partido en trozos por `sep`.
fn core(file: &str, from: &str, to: &str, sep: &str) -> Vec<String> {
    let path = format!("{}/../../core/src/model/{file}", env!("CARGO_MANIFEST_DIR"));
    let source = std::fs::read_to_string(path).unwrap();
    let part = source.split(from).nth(1).unwrap().split(to).next().unwrap();
    part.split(sep).skip(1).map(str::to_owned).collect()
}

/// Las cadenas entre comillas de la lista `name = [ ... ] as const` de `file`.
fn core_list(file: &str, name: &str) -> Vec<String> {
    let list = core(file, &format!("{name} = ["), "] as const", "\"");
    list.into_iter().step_by(2).collect()
}

#[test]
fn las_listas_cerradas_son_las_de_core() {
    let words = |list: &'static str| list.split(' ').collect::<Vec<_>>();
    assert_eq!(words(ROLES), core_list("ids.ts", "AGENT_ROLES"));
    assert_eq!(
        words(OUTCOMES),
        core_list("planning.ts", "SESSION_OUTCOMES")
    );
    assert_eq!(
        words(GATE_STATUSES),
        core_list("building.ts", "GATE_STATUSES")
    );
    // Cada `E<"tipo", …>` de `TaskEvent`, esté o no en la misma línea que `E<`.
    let task = core(
        "events.ts",
        "export type TaskEvent =",
        "export type AdminEvent",
        "E<",
    );
    let quoted = task.iter().filter_map(|s| s.trim_start().strip_prefix('"'));
    let mut types: Vec<&str> = quoted.map(|s| &s[..s.find('"').unwrap()]).collect();
    let mut ours = words(TYPES);
    types.sort();
    ours.sort();
    assert_eq!(ours, types);
}
