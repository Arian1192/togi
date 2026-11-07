//! Comando de lectura de la lista de tareas (ADR-010 §3). Pide `GET /v1/tasks` por el socket del
//! daemon y devuelve solo lo que pinta una fila, con el texto limpio y sin el token.

use crate::daemon::{connection, get, home};
use serde::Serialize;
use serde_json::Value;
use std::path::Path;

/// Lo que pide `togi status`, y lo máximo que devuelve la API (`limit` va de 1 a 200).
const PAGE: usize = 200;
const MAX_BODY: usize = 1024 * 1024;
const MAX_TITLE: usize = 120;
/// El mayor entero que JavaScript representa sin perder precisión.
const MAX_SAFE: u64 = (1 << 53) - 1;

/// Una fila de la lista. El resto de campos del daemon (repo, rama, riesgo…) no llegan al webview.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSummary {
    pub number: u64,
    pub title: Option<String>,
    pub title_erased: bool,
    pub state: String,
    pub has_criteria: bool,
    pub updated_at: String,
    pub version: u64,
}

/// La respuesta del comando. Si no hay lista, un motivo cerrado y nunca texto del daemon.
#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum TaskList {
    /// `truncated`: la API devolvió su máximo, así que puede haber más tareas.
    Ok { tasks: Vec<TaskSummary>, truncated: bool },
    Unreachable { reason: &'static str },
}

fn unreachable(reason: &'static str) -> TaskList {
    TaskList::Unreachable { reason }
}

/// Pide la lista al daemon de `home`. Nunca devuelve el token ni nada que lo contenga.
pub fn tasks_at(home: &Path) -> TaskList {
    let (token, socket) = match connection(home) {
        Ok(connection) => connection,
        Err(reason) => return unreachable(reason),
    };
    match get(&socket, &token, &format!("/v1/tasks?limit={PAGE}"), MAX_BODY) {
        Ok((200, body)) => match parse(&body, &token) {
            Some((tasks, truncated)) => TaskList::Ok { tasks, truncated },
            None => unreachable("bad_response"),
        },
        Ok((401, _)) => unreachable("unauthorized"),
        Ok(_) => unreachable("bad_response"),
        Err(reason) => unreachable(reason),
    }
}

/// Todas las tareas válidas o ninguna: un dato fuera de contrato invalida la lista entera.
fn parse(body: &[u8], token: &str) -> Option<(Vec<TaskSummary>, bool)> {
    let json: Value = serde_json::from_slice(body).ok()?;
    let rows = json.get("tasks")?.as_array()?;
    let tasks = rows.iter().map(|row| summary(row, token)).collect::<Option<Vec<_>>>()?;
    Some((tasks, rows.len() >= PAGE))
}

fn summary(row: &Value, token: &str) -> Option<TaskSummary> {
    let int = |name: &str| row.get(name)?.as_u64().filter(|n| *n <= MAX_SAFE);
    let text = |name: &str| row.get(name)?.as_str();
    let number = int("number").filter(|n| *n >= 1)?;
    let title = match row.get("title")? {
        Value::Null => None,
        Value::String(title) => Some(one_line(title)),
        _ => return None,
    };
    let state = text("state")?;
    let updated_at = text("updatedAt")?;
    let clean = |s: &str, ok: fn(char) -> bool| !s.is_empty() && s.len() <= 32 && s.chars().all(ok);
    let valid = clean(state, |c| c.is_ascii_lowercase() || c == '_')
        && clean(updated_at, |c| c.is_ascii_digit() || "T:.-+Z".contains(c));
    let leaks = title.as_deref().is_some_and(|t| t.contains(token));
    if !valid || leaks {
        return None;
    }
    Some(TaskSummary {
        number,
        title,
        title_erased: row.get("titleErased")?.as_bool()?,
        state: state.to_owned(),
        has_criteria: row.get("hasCriteria")?.as_bool()?,
        updated_at: updated_at.to_owned(),
        version: int("version")?,
    })
}

/// El título en una sola línea, sin caracteres de control y recortado a `MAX_TITLE` caracteres.
fn one_line(title: &str) -> String {
    let spaced: String = title.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    let line = spaced.split_whitespace().collect::<Vec<_>>().join(" ");
    line.chars().take(MAX_TITLE).collect()
}

const MAX_DETAIL_BODY: usize = 512 * 1024;
const MAX_CRITERIA: usize = 80_000;

/// Lo que pinta la portada del cuaderno: la línea de contexto, el título y el criterio. La
/// descripción y las fechas del daemon no llegan al webview.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDetail {
    pub number: u64,
    pub title: Option<String>,
    pub title_erased: bool,
    pub state: String,
    pub risk: String,
    pub repo: String,
    pub base_branch: String,
    /// El criterio de aceptación tal cual, como texto; `None` si está borrado.
    pub criteria: Option<String>,
    pub criteria_erased: bool,
    pub version: u64,
    pub plan_version: Option<u64>,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum TaskRead {
    Ok { task: TaskDetail },
    Unreachable { reason: &'static str },
}

/// Pide `GET /v1/tasks/:n` al daemon de `home`. Nunca devuelve el token ni nada que lo contenga.
pub fn task_at(home: &Path, number: u64) -> TaskRead {
    let unreachable = |reason| TaskRead::Unreachable { reason };
    if !(1..=MAX_SAFE).contains(&number) {
        return unreachable("invalid_request");
    }
    let (token, socket) = match connection(home) {
        Ok(connection) => connection,
        Err(reason) => return unreachable(reason),
    };
    match get(&socket, &token, &format!("/v1/tasks/{number}"), MAX_DETAIL_BODY) {
        Ok((200, body)) => match detail(&body, &token).filter(|t| t.number == number) {
            Some(task) => TaskRead::Ok { task },
            None => unreachable("bad_response"),
        },
        Ok((401, _)) => unreachable("unauthorized"),
        Ok((404, _)) => unreachable("not_found"),
        Ok(_) => unreachable("bad_response"),
        Err(reason) => unreachable(reason),
    }
}

/// Todo o nada: un dato fuera de contrato invalida el detalle entero.
fn detail(body: &[u8], token: &str) -> Option<TaskDetail> {
    let json: Value = serde_json::from_slice(body).ok()?;
    let int = |v: Option<&Value>| v?.as_u64().filter(|n| *n <= MAX_SAFE);
    let text = |name: &str, max: usize| {
        json.get(name)?.as_str().filter(|s| s.len() <= max && !s.contains(token))
    };
    let line = |s: &str| !s.is_empty() && !s.chars().any(char::is_control);
    let state = text("state", 32).filter(|s| s.chars().all(|c| c.is_ascii_lowercase() || c == '_'))?;
    let repo = text("repo", 200).filter(|r| {
        r.split('/').count() == 2
            && r.chars().all(|c| c.is_ascii_alphanumeric() || "_.-/".contains(c))
    })?;
    let title = match json.get("title")? {
        Value::Null => None,
        Value::String(title) if !title.contains(token) => Some(one_line(title)),
        _ => return None,
    };
    let criteria = match json.get("acceptanceCriteria")? {
        Value::Null => None,
        Value::String(s) if s.len() <= MAX_CRITERIA && !s.contains(token) => Some(s.clone()),
        _ => return None,
    };
    Some(TaskDetail {
        number: int(json.get("number")).filter(|n| *n >= 1)?,
        title,
        title_erased: json.get("titleErased")?.as_bool()?,
        state: state.to_owned(),
        risk: text("risk", 8).filter(|r| ["low", "medium", "high"].contains(r))?.to_owned(),
        repo: repo.to_owned(),
        base_branch: text("baseBranch", 200).filter(|b| line(b))?.to_owned(),
        criteria,
        criteria_erased: json.get("erased")?.get("acceptanceCriteria")?.as_bool()?,
        version: int(json.get("version")).filter(|n| *n >= 1)?,
        plan_version: match json.get("planVersion")? {
            Value::Null => None,
            v => Some(int(Some(v))?),
        },
    })
}

/// Pide el detalle de una tarea; el trabajo bloqueante va a otro hilo.
#[tauri::command]
pub async fn read_task(number: u64) -> TaskRead {
    let Some(home) = home() else {
        return TaskRead::Unreachable { reason: "no_home" };
    };
    tauri::async_runtime::spawn_blocking(move || task_at(&home, number))
        .await
        .unwrap_or(TaskRead::Unreachable { reason: "internal" })
}

/// Segundo comando que ve el webview, junto a `get_daemon_status`. El trabajo bloqueante va a otro hilo.
#[tauri::command]
pub async fn list_tasks() -> TaskList {
    let Some(home) = home() else {
        return unreachable("no_home");
    };
    tauri::async_runtime::spawn_blocking(move || tasks_at(&home))
        .await
        .unwrap_or_else(|_| unreachable("internal"))
}
