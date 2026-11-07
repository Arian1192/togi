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
