//! Comando de lectura del plan vigente de una tarea (ADR-010 §3). Pide `GET /v1/tasks/:n/plan` por
//! el socket del daemon y devuelve solo lo que pinta la vista, con el texto sin transformar y sin
//! el token. El webview solo pasa el número de tarea: la ruta y el método los pone este módulo.

use crate::daemon::{connection, home, request, Reply};
use serde::Serialize;
use serde_json::Value;
use std::path::Path;

const MAX_BODY: usize = 1024 * 1024;
const MAX_ITEMS: usize = 500;
const MAX_PATH: usize = 1024;
const MAX_APPROACH: usize = 100_000;
/// El mayor entero que JavaScript representa sin perder precisión.
const MAX_SAFE: u64 = (1 << 53) - 1;

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

/// `version` es la del `ETag` de la tarea: la que una decisión devolverá en `If-Match`.
#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum PlanRead {
    Ok { plan: PlanView, version: u64 },
    Unreachable { reason: &'static str },
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
        Ok(Reply { code: 200, etag, body }) => {
            let version = etag.and_then(|e| e.trim_matches('"').parse::<u64>().ok()).filter(|v| valid_id(*v));
            match (version, parse(&body, &token)) {
                (Some(version), Some(plan)) => PlanRead::Ok { plan, version },
                _ => unreachable("bad_response"),
            }
        }
        Ok(Reply { code: 401, .. }) => unreachable("unauthorized"),
        Ok(Reply { code: 404, .. }) => unreachable("not_found"),
        Ok(_) => unreachable("bad_response"),
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
            let change = f.get("change")?.as_str().filter(|c| ["add", "modify", "delete"].contains(c))?;
            Some(PlanFile { path: path(f.get("path")?, token)?, change: change.to_owned() })
        })
        .collect::<Option<Vec<_>>>()?;
    let new_tests = list("newTests")?.iter().map(|t| path(t, token)).collect::<Option<Vec<_>>>()?;
    let lines = json.get("estimatedLines")?;
    Some(PlanView {
        plan_version: int(json.get("planVersion")).filter(|n| *n >= 1)?,
        files,
        new_tests,
        approach: text(json.get("approach")?, token, MAX_APPROACH)?.to_owned(),
        approach_erased: json.get("approachErased")?.as_bool()?,
        estimated_lines: Lines { production: int(lines.get("production"))?, tests: int(lines.get("tests"))? },
    })
}

/// Tercer comando que ve el webview, junto a `get_daemon_status` y `list_tasks`. El trabajo
/// bloqueante va a otro hilo.
#[tauri::command]
pub async fn read_plan(number: u64) -> PlanRead {
    let Some(home) = home() else {
        return PlanRead::Unreachable { reason: "no_home" };
    };
    tauri::async_runtime::spawn_blocking(move || plan_at(&home, number))
        .await
        .unwrap_or(PlanRead::Unreachable { reason: "internal" })
}
