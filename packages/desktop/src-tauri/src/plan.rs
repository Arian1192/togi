//! Comandos del plan (ADR-010 §3): leer el plan vigente de una tarea y decidir sobre él. El webview
//! solo pasa número de tarea, versión vista, categoría y motivo; la ruta, el método y `If-Match`
//! los pone este módulo. Aprobar y rechazar piden confirmación con un diálogo nativo desde Rust, que
//! un script del webview no puede pulsar, y sin confirmar no se llama al daemon.

use crate::daemon::{connection, home, request, Reply};
use serde::Serialize;
use serde_json::{json, Value};
use std::path::Path;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

const MAX_BODY: usize = 1024 * 1024;
const MAX_ITEMS: usize = 500;
const MAX_PATH: usize = 1024;
const MAX_APPROACH: usize = 100_000;
/// El límite del motivo en el daemon, que cuenta unidades UTF-16.
const MAX_REASON: usize = 5_000;
/// El mayor entero que JavaScript representa sin perder precisión.
const MAX_SAFE: u64 = (1 << 53) - 1;
/// `REASON_CATEGORIES` de `@togi/core`; plan-boundary.rs vigila que sigan siendo las mismas.
pub const CATEGORIES: [&str; 6] = [
    "misunderstanding",
    "scope",
    "logic",
    "tests",
    "style",
    "other",
];

#[derive(Debug, PartialEq, Serialize)]
pub struct PlanFile {
    pub path: String,
    pub change: String,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct Lines {
    pub production: u64,
    pub tests: u64,
}

/// El plan vigente tal como lo pinta la vista; sin sesión, sha base ni planes anteriores.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanView {
    pub plan_version: u64,
    pub files: Vec<PlanFile>,
    pub new_tests: Vec<String>,
    pub approach: String,
    pub approach_erased: bool,
    pub estimated_lines: Lines,
}

/// `version` es la del `ETag` de la tarea: la que las decisiones devuelven en `If-Match`.
#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum PlanRead {
    Ok { plan: PlanView, version: u64 },
    Unreachable { reason: &'static str },
}

/// Resultado de una decisión. `PlanChanged` es un 412: hay que releer el plan antes de decidir, y
/// no se reintenta. Los motivos son cerrados, nunca texto del daemon.
#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum Decision {
    Ok,
    PlanChanged,
    Cancelled,
    Failed { reason: &'static str },
}

fn failed(reason: &'static str) -> Decision {
    Decision::Failed { reason }
}

/// Motivo cerrado para un código HTTP que no es el esperado.
fn closed_reason(code: u16) -> &'static str {
    match code {
        401 => "unauthorized",
        404 => "not_found",
        409 => "conflict",
        _ => "bad_response",
    }
}

fn valid_id(n: u64) -> bool {
    (1..=MAX_SAFE).contains(&n)
}

/// Pide el plan vigente de la tarea `number` al daemon de `home`. Nunca devuelve el token ni nada
/// que lo contenga: un plan con el token en cualquier texto se rechaza entero.
pub fn plan_at(home: &Path, number: u64) -> PlanRead {
    let unreachable = |reason| PlanRead::Unreachable { reason };
    if !valid_id(number) {
        return unreachable("invalid_request");
    }
    let (token, socket) = match connection(home) {
        Ok(connection) => connection,
        Err(reason) => return unreachable(reason),
    };
    let path = format!("/v1/tasks/{number}/plan");
    match request(&socket, &token, "GET", &path, &[], None, MAX_BODY) {
        Ok(Reply {
            code: 200,
            etag,
            body,
        }) => {
            let version = etag
                .and_then(|e| e.trim_matches('"').parse::<u64>().ok())
                .filter(|v| valid_id(*v));
            match (version, parse(&body, &token)) {
                (Some(version), Some(plan)) => PlanRead::Ok { plan, version },
                _ => unreachable("bad_response"),
            }
        }
        Ok(reply) => unreachable(closed_reason(reply.code)),
        Err(reason) => unreachable(reason),
    }
}

/// Un texto del contrato: de a lo sumo `max` bytes y sin el token.
fn text<'a>(v: &'a Value, token: &str, max: usize) -> Option<&'a str> {
    v.as_str().filter(|s| s.len() <= max && !s.contains(token))
}

/// Una ruta del repo: no vacía, en una línea.
fn path(v: &Value, token: &str) -> Option<String> {
    let path = text(v, token, MAX_PATH)?;
    (!path.is_empty() && !path.chars().any(char::is_control)).then(|| path.to_owned())
}

/// Todo o nada: un dato fuera de contrato invalida el plan entero. El enfoque se devuelve tal cual,
/// como texto, sin transformarlo.
fn parse(body: &[u8], token: &str) -> Option<PlanView> {
    let json: Value = serde_json::from_slice(body).ok()?;
    let int = |v: Option<&Value>| v?.as_u64().filter(|n| *n <= MAX_SAFE);
    let list = |name: &str| json.get(name)?.as_array().filter(|a| a.len() <= MAX_ITEMS);
    let files = list("files")?
        .iter()
        .map(|f| {
            let change = f
                .get("change")?
                .as_str()
                .filter(|c| ["add", "modify", "delete"].contains(c))?;
            Some(PlanFile {
                path: path(f.get("path")?, token)?,
                change: change.to_owned(),
            })
        })
        .collect::<Option<Vec<_>>>()?;
    let new_tests = list("newTests")?
        .iter()
        .map(|t| path(t, token))
        .collect::<Option<Vec<_>>>()?;
    let lines = json.get("estimatedLines")?;
    Some(PlanView {
        plan_version: int(json.get("planVersion")).filter(|n| *n >= 1)?,
        files,
        new_tests,
        approach: text(json.get("approach")?, token, MAX_APPROACH)?.to_owned(),
        approach_erased: json.get("approachErased")?.as_bool()?,
        estimated_lines: Lines {
            production: int(lines.get("production"))?,
            tests: int(lines.get("tests"))?,
        },
    })
}

#[derive(Debug, PartialEq)]
pub struct Reason {
    category: &'static str,
    text: String,
}

impl Reason {
    /// Categoría de la lista cerrada y motivo no vacío, recortado y de a lo sumo `MAX_REASON`.
    pub fn new(category: &str, text: &str) -> Option<Reason> {
        let category = CATEGORIES.iter().find(|c| **c == category)?;
        let text = text.trim();
        (!text.is_empty() && text.encode_utf16().count() <= MAX_REASON).then(|| Reason {
            category,
            text: text.to_owned(),
        })
    }
}

#[derive(Debug, PartialEq)]
pub enum Action {
    Approve,
    RequestChanges(Reason),
    Reject(Reason),
}

impl Action {
    /// La ruta del daemon, la pregunta de confirmación (`None`: no hace falta) y el cuerpo.
    fn parts(&self, number: u64) -> (&'static str, Option<String>, Vec<u8>) {
        let body = |r: &Reason| {
            json!({ "reason": { "category": r.category, "text": r.text } }).to_string()
        };
        match self {
            Action::Approve => {
                let question = format!(
                    "¿Aprobar el plan de la tarea {number}? El agente empezará a construir."
                );
                ("approve", Some(question), Vec::new())
            }
            Action::RequestChanges(r) => ("request-changes", None, body(r).into_bytes()),
            Action::Reject(r) => {
                let question =
                    format!("¿Rechazar el plan de la tarea {number}? La tarea queda rechazada.");
                ("reject", Some(question), body(r).into_bytes())
            }
        }
    }
}

/// Quien confirma una acción. En la app es un diálogo nativo; en los tests, un doble.
pub trait Confirm {
    fn ask(&self, question: &str) -> bool;
}

/// Diálogo nativo del sistema, abierto desde Rust: ningún permiso de diálogo llega al webview, así
/// que un script de la página no puede ni abrirlo ni pulsarlo. Bloquea: va en un hilo aparte.
struct Native(tauri::AppHandle);

impl Confirm for Native {
    fn ask(&self, question: &str) -> bool {
        self.0
            .dialog()
            .message(question)
            .title("togi")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Confirmar".into(),
                "Cancelar".into(),
            ))
            .blocking_show()
    }
}

/// Decide sobre el plan de `number` que la persona vio en `version` (el `ETag` de `plan_at`). Pide
/// confirmación antes de llamar al daemon y no la pide si no puede conectar. Un 412 es `PlanChanged`
/// y no se reintenta.
pub fn decide_at(
    home: &Path,
    number: u64,
    version: u64,
    action: &Action,
    confirm: &dyn Confirm,
) -> Decision {
    if !valid_id(number) || !valid_id(version) {
        return failed("invalid_request");
    }
    let (token, socket) = match connection(home) {
        Ok(connection) => connection,
        Err(reason) => return failed(reason),
    };
    let (verb, question, body) = action.parts(number);
    if question.is_some_and(|q| !confirm.ask(&q)) {
        return Decision::Cancelled;
    }
    let path = format!("/v1/tasks/{number}/plan/{verb}");
    let if_match = format!("\"{version}\"");
    match request(
        &socket,
        &token,
        "POST",
        &path,
        &[("If-Match", &if_match)],
        Some(&body),
        MAX_BODY,
    ) {
        Ok(Reply { code: 200, .. }) => Decision::Ok,
        Ok(Reply { code: 412, .. }) => Decision::PlanChanged,
        Ok(reply) => failed(closed_reason(reply.code)),
        Err(reason) => failed(reason),
    }
}

/// El trabajo bloqueante (red y diálogo) va a otro hilo para no congelar la ventana.
async fn decide(
    app: tauri::AppHandle,
    number: u64,
    version: u64,
    action: Option<Action>,
) -> Decision {
    let Some(action) = action else {
        return failed("invalid_request");
    };
    let Some(home) = home() else {
        return failed("no_home");
    };
    tauri::async_runtime::spawn_blocking(move || {
        decide_at(&home, number, version, &action, &Native(app))
    })
    .await
    .unwrap_or_else(|_| failed("internal"))
}

#[tauri::command]
pub async fn read_plan(number: u64) -> PlanRead {
    let Some(home) = home() else {
        return PlanRead::Unreachable { reason: "no_home" };
    };
    tauri::async_runtime::spawn_blocking(move || plan_at(&home, number))
        .await
        .unwrap_or(PlanRead::Unreachable { reason: "internal" })
}

/// Pide confirmación con un diálogo nativo.
#[tauri::command]
pub async fn approve_plan(app: tauri::AppHandle, number: u64, version: u64) -> Decision {
    decide(app, number, version, Some(Action::Approve)).await
}

/// No pide confirmación: pedir cambios no cierra la tarea.
#[tauri::command]
pub async fn request_plan_changes(
    app: tauri::AppHandle,
    number: u64,
    version: u64,
    category: String,
    text: String,
) -> Decision {
    decide(
        app,
        number,
        version,
        Reason::new(&category, &text).map(Action::RequestChanges),
    )
    .await
}

/// Pide confirmación con un diálogo nativo.
#[tauri::command]
pub async fn reject_plan(
    app: tauri::AppHandle,
    number: u64,
    version: u64,
    category: String,
    text: String,
) -> Decision {
    decide(
        app,
        number,
        version,
        Reason::new(&category, &text).map(Action::Reject),
    )
    .await
}
