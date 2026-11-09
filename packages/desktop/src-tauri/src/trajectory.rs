//! `read_trajectory` (ADR-010 §3): las acciones de la sesión de una tarea, como texto acotado. Lo
//! que escribe el agente es entrada no fiable (§8): aquí se reduce a un texto corto sin caracteres
//! de control y nunca llega al webview como JSON. El webview solo pasa el número de tarea y el
//! cursor; la sesión (la activa o, si no hay, la última) la elige este módulo, y su id no sale.

use crate::daemon::{connection, home, request, Reply};
use crate::plan::closed_reason;
use serde::Serialize;
use serde_json::Value;
use std::path::Path;

const MAX_BODY: usize = 1024 * 1024;
const MAX_SESSIONS: usize = 500;
const PAGE: usize = 20;
const MAX_TEXT: usize = 500;
/// El mayor entero que JavaScript representa sin perder precisión.
const MAX_SAFE: u64 = (1 << 53) - 1;
/// `AGENT_EVENT_KINDS` de `@togi/core`.
const KINDS: [&str; 5] = ["tool_call", "tool_result", "message", "denied", "usage"];

#[derive(Debug, PartialEq, Serialize)]
pub struct Row {
    pub seq: u64,
    pub at: String,
    pub kind: &'static str,
    pub text: String,
    pub erased: bool,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum TrajectoryRead {
    #[serde(rename_all = "camelCase")]
    Ok {
        events: Vec<Row>,
        next_after: u64,
        has_more: bool,
        session_state: &'static str,
    },
    NoSession,
    Unreachable {
        reason: &'static str,
    },
}

fn unreachable(reason: &'static str) -> TrajectoryRead {
    TrajectoryRead::Unreachable { reason }
}

/// Pide la trayectoria de la sesión elegida de la tarea `number`, a partir de `after`. Nunca
/// devuelve el token: un evento con el token en cualquier texto invalida la página entera.
pub fn trajectory_at(home: &Path, number: u64, after: u64) -> TrajectoryRead {
    if !(1..=MAX_SAFE).contains(&number) || after > MAX_SAFE {
        return unreachable("invalid_request");
    }
    let (token, socket) = match connection(home) {
        Ok(connection) => connection,
        Err(reason) => return unreachable(reason),
    };
    let get = |path: &str| match request(&socket, &token, "GET", path, &[], None, MAX_BODY) {
        Ok(Reply {
            code: 200, body, ..
        }) => serde_json::from_slice::<Value>(&body).map_err(|_| "bad_response"),
        Ok(reply) => Err(closed_reason(reply.code)),
        Err(reason) => Err(reason),
    };
    let listed = match get(&format!("/v1/tasks/{number}/sessions")) {
        Ok(json) => json,
        Err(reason) => return unreachable(reason),
    };
    let session = match pick_session(&listed) {
        Ok(Some(id)) => id,
        Ok(None) => return TrajectoryRead::NoSession,
        Err(reason) => return unreachable(reason),
    };
    let path =
        format!("/v1/tasks/{number}/sessions/{session}/trajectory?after={after}&limit={PAGE}");
    match get(&path) {
        Ok(json) => parse(&json, &token).unwrap_or_else(|| unreachable("bad_response")),
        Err(reason) => unreachable(reason),
    }
}

/// La sesión activa o, si no hay, la de `startedAt` más reciente. Un id que no sea `ses_` más
/// caracteres seguros invalida la lista: va a la ruta de la petición.
fn pick_session(json: &Value) -> Result<Option<String>, &'static str> {
    let list = json
        .get("sessions")
        .and_then(Value::as_array)
        .filter(|a| a.len() <= MAX_SESSIONS)
        .ok_or("bad_response")?;
    let mut best: Option<(bool, &str, &str)> = None;
    for s in list {
        let field = |name| s.get(name).and_then(Value::as_str);
        let (Some(id), Some(state), Some(started)) =
            (field("sessionId"), field("state"), field("startedAt"))
        else {
            return Err("bad_response");
        };
        let safe = id.len() <= 64
            && id.starts_with("ses_")
            && id.len() > 4
            && id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
        if !safe {
            return Err("bad_response");
        }
        let key = (state == "active", started, id);
        if best.is_none_or(|b| (key.0, key.1) > (b.0, b.1)) {
            best = Some(key);
        }
    }
    Ok(best.map(|(_, _, id)| id.to_owned()))
}

/// El texto de un evento: la cadena, o el primer `text`, `tool` o `reason` que sea una cadena.
/// Sin caracteres de control y de a lo sumo `MAX_TEXT` caracteres.
fn text_of(content: &Value) -> String {
    let raw = match content {
        Value::String(s) => Some(s.as_str()),
        Value::Object(o) => ["text", "tool", "reason"]
            .iter()
            .find_map(|k| o.get(*k).and_then(Value::as_str)),
        _ => None,
    };
    raw.unwrap_or_default()
        .chars()
        .filter(|c| !c.is_control() || *c == '\n')
        .take(MAX_TEXT)
        .collect()
}

/// Todo o nada: un dato fuera de contrato invalida la página.
fn parse(json: &Value, token: &str) -> Option<TrajectoryRead> {
    let int = |v: Option<&Value>| v?.as_u64().filter(|n| *n <= MAX_SAFE);
    let events = json
        .get("events")?
        .as_array()
        .filter(|a| a.len() <= PAGE)?
        .iter()
        .map(|e| {
            let content = e.get("content")?;
            if content.to_string().contains(token) {
                return None;
            }
            let at = e
                .get("at")?
                .as_str()
                .filter(|a| a.len() <= 40 && !a.contains(token))?;
            let wanted = e.get("kind")?.as_str()?;
            let kind = KINDS.iter().find(|k| **k == wanted)?;
            let erased = e.get("contentErased")?.as_bool()?;
            Some(Row {
                seq: int(e.get("seq")).filter(|n| *n >= 1)?,
                at: at.to_owned(),
                kind,
                text: if erased {
                    String::new()
                } else {
                    text_of(content)
                },
                erased,
            })
        })
        .collect::<Option<Vec<_>>>()?;
    let session_state = match json.get("sessionState")?.as_str()? {
        "active" => "active",
        "ended" => "ended",
        _ => return None,
    };
    Some(TrajectoryRead::Ok {
        events,
        next_after: int(json.get("nextAfter"))?,
        has_more: json.get("hasMore")?.as_bool()?,
        session_state,
    })
}

/// Comando que ve el webview. El trabajo bloqueante va a otro hilo para no congelar la ventana.
#[tauri::command]
pub async fn read_trajectory(number: u64, after: u64) -> TrajectoryRead {
    let Some(home) = home() else {
        return unreachable("no_home");
    };
    tauri::async_runtime::spawn_blocking(move || trajectory_at(&home, number, after))
        .await
        .unwrap_or_else(|_| unreachable("internal"))
}
