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
    /// El texto se recortó a `MAX_TEXT` caracteres.
    pub truncated: bool,
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
        /// Identifica la sesión de `nextAfter` (su `startedAt`); el webview la devuelve con el cursor.
        session_mark: String,
    },
    NoSession,
    /// La sesión elegida ya no es la del cursor: hay que volver a leer desde 0.
    SessionChanged,
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
    trajectory_for(home, number, after, None)
}

/// Como `trajectory_at`, con la marca de la sesión de la que viene `after`: si Rust elige ahora otra,
/// devuelve `SessionChanged` sin pedir la trayectoria, porque el `seq` de una sesión no vale en otra.
pub fn trajectory_for(home: &Path, number: u64, after: u64, mark: Option<&str>) -> TrajectoryRead {
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
        }) => serde_json::from_slice::<Value>(&body).map_err(|_| "invalid_json"),
        Ok(reply) => Err(closed_reason(reply.code)),
        Err(reason) => Err(reason),
    };
    // El JSON roto no es un motivo de la API: sale como cualquier otra respuesta fuera de contrato.
    let closed = |reason| match reason {
        "invalid_json" => "bad_response",
        other => other,
    };
    let listed = match get(&format!("/v1/tasks/{number}/sessions")) {
        Ok(json) => json,
        Err(reason) => return unreachable(closed(reason)),
    };
    let (session, started, active) = match pick_session(&listed, &token) {
        Ok(Some(picked)) => picked,
        Ok(None) => return TrajectoryRead::NoSession,
        Err(reason) => return unreachable(reason),
    };
    if mark.is_some_and(|m| m != started) {
        return TrajectoryRead::SessionChanged;
    }
    let page = |limit| {
        format!("/v1/tasks/{number}/sessions/{session}/trajectory?after={after}&limit={limit}")
    };
    // Una página mayor que el cuerpo máximo se reintenta con un solo evento; si ni ese cabe, una
    // fila marcadora lo salta. Sin esto el cursor no avanza y la sesión queda ilegible para siempre.
    let json = match get(&page(PAGE)) {
        Err("bad_response") => match get(&page(1)) {
            Err("bad_response") => return oversized(after, active, started),
            other => other,
        },
        other => other,
    };
    match json {
        Ok(json) => {
            parse(&json, &token, after, started).unwrap_or_else(|| unreachable("bad_response"))
        }
        Err(reason) => unreachable(closed(reason)),
    }
}

/// El evento siguiente a `after` no cabe en el cuerpo máximo: una fila sin texto y el cursor un paso
/// más allá. El estado de la sesión es el de la lista; la página real no se pudo leer.
fn oversized(after: u64, active: bool, mark: String) -> TrajectoryRead {
    let seq = after + 1;
    TrajectoryRead::Ok {
        events: vec![Row {
            seq,
            at: String::new(),
            kind: "oversized",
            text: String::new(),
            truncated: false,
            erased: false,
        }],
        next_after: seq,
        has_more: true,
        session_state: if active { "active" } else { "ended" },
        session_mark: mark,
    }
}

/// La sesión activa o, si no hay, la de `startedAt` más reciente. Un id que no sea `ses_` más
/// caracteres seguros invalida la lista: va a la ruta de la petición.
fn pick_session(json: &Value, token: &str) -> Result<Option<(String, String, bool)>, &'static str> {
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
        // `startedAt` es la marca que sale al webview: corta y sin el token.
        if !safe || started.len() > 40 || started.contains(token) {
            return Err("bad_response");
        }
        let key = (state == "active", started, id);
        if best.is_none_or(|b| (key.0, key.1) > (b.0, b.1)) {
            best = Some(key);
        }
    }
    Ok(best.map(|(active, started, id)| (id.to_owned(), started.to_owned(), active)))
}

/// Caracteres de formato que no se ven y permiten que un texto se lea de otra forma (bidi, anchura
/// cero, guion blando, BOM).
fn invisible(c: char) -> bool {
    matches!(c, '\u{00ad}' | '\u{200b}'..='\u{200f}' | '\u{202a}'..='\u{202e}'
        | '\u{2060}'..='\u{2064}' | '\u{2066}'..='\u{2069}' | '\u{feff}')
}

/// El texto de un evento: la cadena, o el primer `text`, `tool` o `reason` que sea una cadena.
/// Sin caracteres de control y de a lo sumo `MAX_TEXT` caracteres.
fn text_of(content: &Value) -> (String, bool) {
    let raw = match content {
        Value::String(s) => Some(s.as_str()),
        Value::Object(o) => ["text", "tool", "reason"]
            .iter()
            .find_map(|k| o.get(*k).and_then(Value::as_str)),
        _ => None,
    };
    let mut text: String = raw
        .unwrap_or_default()
        .chars()
        .filter(|c| (!c.is_control() || *c == '\n') && !invisible(*c))
        .take(MAX_TEXT + 1)
        .collect();
    let truncated = text.chars().count() > MAX_TEXT;
    if truncated {
        text = text.chars().take(MAX_TEXT).collect();
    }
    (text, truncated)
}

/// Todo o nada: un dato fuera de contrato invalida la página.
fn parse(json: &Value, token: &str, after: u64, mark: String) -> Option<TrajectoryRead> {
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
            let (text, truncated) = if erased {
                (String::new(), false)
            } else {
                text_of(content)
            };
            Some(Row {
                seq: int(e.get("seq")).filter(|n| *n >= 1)?,
                at: at.to_owned(),
                kind,
                text,
                truncated,
                erased,
            })
        })
        .collect::<Option<Vec<_>>>()?;
    let session_state = match json.get("sessionState")?.as_str()? {
        "active" => "active",
        "ended" => "ended",
        _ => return None,
    };
    // El cursor solo avanza: los `seq` crecen desde `after` y `nextAfter` es el último (o `after`).
    let next_after = int(json.get("nextAfter"))?;
    let mut last = after;
    for row in &events {
        if row.seq <= last {
            return None;
        }
        last = row.seq;
    }
    if next_after != last {
        return None;
    }
    Some(TrajectoryRead::Ok {
        events,
        next_after,
        has_more: json.get("hasMore")?.as_bool()?,
        session_state,
        session_mark: mark,
    })
}

/// Comando que ve el webview. El trabajo bloqueante va a otro hilo para no congelar la ventana.
#[tauri::command]
pub async fn read_trajectory(number: u64, after: u64, mark: Option<String>) -> TrajectoryRead {
    let Some(home) = home() else {
        return unreachable("no_home");
    };
    tauri::async_runtime::spawn_blocking(move || {
        trajectory_for(&home, number, after, mark.as_deref())
    })
    .await
    .unwrap_or_else(|_| unreachable("internal"))
}
