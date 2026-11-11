//! `read_task_activity` (ADR-010 §3, «Panel derecho»): los movimientos de una tarea para Actividad,
//! del más antiguo al más reciente. De cada evento de `GET /v1/tasks/:n/events` salen su tipo, su
//! actor sin ids de usuario y campos cerrados; nunca un blob, un prompt ni texto libre (§8).

use crate::daemon::{connection, get, home};
use crate::plan::closed_reason;
use serde::Serialize;
use serde_json::{json, Value};
use std::path::Path;

/// La ruta devuelve todos los eventos de la tarea, sin páginas.
const MAX_BODY: usize = 4 * 1024 * 1024;
/// Los movimientos que salen como mucho: los más recientes.
pub const MAX_ITEMS: usize = 1000;
/// El mayor entero que JavaScript representa sin perder precisión.
const MAX_SAFE: u64 = (1 << 53) - 1;
/// Listas de `@togi/core` separadas por espacios; activity-boundary.rs vigila que no cambien.
pub const TYPES: &str = "task.created task.edited task.submitted session.started session.ended \
    plan.retry_requested plan.proposed decision.recorded task.rejected task.completed \
    workspace.created build.submitted gate.completed verification.completed task.failed \
    failure.classified workspace.released";
pub const ROLES: &str = "planner builder reviewer";
pub const OUTCOMES: &str = "completed failed cancelled timeout";
pub const GATE_STATUSES: &str = "pass fail error";
const COMPONENTS: &str = "gates integrator merger catalog";
const CYCLED: &str = "gate.completed build.submitted verification.completed task.failed";

/// `truncated`: había más de `MAX_ITEMS` movimientos y faltan los más antiguos.
#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ActivityRead {
    Ok { items: Vec<Value>, truncated: bool },
    Unreachable { reason: &'static str },
}

/// Los movimientos de la tarea `number`. Nunca el token: un movimiento con él invalida la respuesta.
pub fn activity_at(home: &Path, number: u64) -> ActivityRead {
    let unreachable = |reason| ActivityRead::Unreachable { reason };
    if !(1..=MAX_SAFE).contains(&number) {
        return unreachable("invalid_request");
    }
    let (token, socket) = match connection(home) {
        Ok(connection) => connection,
        Err(reason) => return unreachable(reason),
    };
    let path = format!("/v1/tasks/{number}/events");
    match get(&socket, &token, &path, MAX_BODY) {
        Ok((200, body)) => match parse(&body, &token) {
            Some((items, truncated)) => ActivityRead::Ok { items, truncated },
            None => unreachable("bad_response"),
        },
        Ok((code, _)) => unreachable(closed_reason(code)),
        Err(reason) => unreachable(reason),
    }
}

fn one_of(set: &'static str, value: &str) -> Option<&'static str> {
    set.split(' ').find(|s| *s == value)
}

/// Un código de una lista de `@togi/core` que crece (gates, motivos); el daemon ya la valida al leer.
fn code(v: Option<&Value>) -> Option<&str> {
    let s = v?.as_str()?;
    let ok = |c: char| c.is_ascii_lowercase() || c == '_';
    (!s.is_empty() && s.len() <= 40 && s.chars().all(ok)).then_some(s)
}

fn int(v: Option<&Value>) -> Option<u64> {
    v?.as_u64().filter(|n| *n <= MAX_SAFE)
}

/// Un nombre corto escrito por togi o el runtime (modelo, especialista, versión): sin espacios.
fn safe(s: &str) -> bool {
    let ok = |c: char| c.is_ascii_alphanumeric() || "._:/@+-".contains(c);
    !s.is_empty() && s.len() <= 100 && s.chars().all(ok)
}

fn name(v: Option<&Value>) -> Option<&str> {
    v?.as_str().filter(|s| safe(s))
}

fn session_id(v: Option<&Value>) -> Option<&str> {
    name(v).filter(|s| s.len() > 4 && s.starts_with("ses_") && !s.contains([':', '/', '@']))
}

/// Todo o nada: un tipo desconocido se salta y un dato fuera de contrato invalida la respuesta. Los
/// estados no se calculan aquí: el webview los saca del mapa de `@togi/core` (ADR-010 §1), con el
/// `verdict` y el `passed` que van en cada movimiento.
fn parse(body: &[u8], token: &str) -> Option<(Vec<Value>, bool)> {
    let json: Value = serde_json::from_slice(body).ok()?;
    let (mut items, mut last) = (Vec::new(), 0);
    for e in json.get("events")?.as_array()? {
        let seq = int(e.get("seq")).filter(|n| *n > last)?;
        last = seq;
        let Some(kind) = one_of(TYPES, e.get("type")?.as_str()?) else {
            continue;
        };
        let ok = |c: char| c.is_ascii_digit() || "T:.-+Z".contains(c);
        let at = e.get("at")?.as_str();
        let at = at.filter(|a| !a.is_empty() && a.len() <= 40 && a.chars().all(ok))?;
        let p = e.get("payload")?;
        let actor = actor(e.get("actor")?)?;
        let mut item = json!({ "seq": seq, "at": at, "type": kind, "actor": actor });
        fields(kind, p, &mut item)?;
        if item.to_string().contains(token) {
            return None;
        }
        items.push(item);
    }
    let cut = items.len().saturating_sub(MAX_ITEMS);
    Some((items.split_off(cut), cut > 0))
}

fn actor(a: &Value) -> Option<Value> {
    let text = |k: &str| a.get(k)?.as_str();
    Some(match text("kind")? {
        "human" => json!({ "kind": "human" }),
        "agent" => json!({ "kind": "agent", "role": one_of(ROLES, text("role")?)? }),
        "system" => {
            let c = text("component")?;
            let ok =
                one_of(COMPONENTS, c).is_some() || c.strip_prefix("adapter:").is_some_and(safe);
            ok.then(|| json!({ "kind": "system", "component": c }))?
        }
        _ => return None,
    })
}

/// Los campos cerrados de cada tipo; los demás tipos no añaden nada.
fn fields(kind: &str, p: &Value, out: &mut Value) -> Option<()> {
    let text = |k: &str| p.get(k)?.as_str();
    let mut put = |k: &str, v: Value| out[k] = v;
    let hex = |s: &&str| matches!(s.len(), 40 | 64) && s.chars().all(|c| c.is_ascii_hexdigit());
    let sha = text("headSha").filter(hex).map(|s| &s[..7]);
    if one_of(CYCLED, kind).is_some() {
        put("cycle", int(p.get("cycle"))?.into());
    }
    match kind {
        "session.started" => {
            let (s, r) = (p.get("specialist")?, p.get("runtime")?);
            let specialist = format!("{}@{}", name(s.get("id"))?, int(s.get("version"))?);
            let runtime = format!("{}@{}", name(r.get("id"))?, name(r.get("version"))?);
            put("role", one_of(ROLES, text("role")?)?.into());
            put("specialist", specialist.into());
            put("runtime", runtime.into());
            put("model", name(p.get("model"))?.into());
            put("sessionId", session_id(p.get("sessionId"))?.into());
        }
        "session.ended" => {
            put("sessionId", session_id(p.get("sessionId"))?.into());
            put("outcome", one_of(OUTCOMES, text("outcome")?)?.into());
            let failure = match p.get("failureReason") {
                None | Some(Value::Null) => Value::Null,
                v => code(v)?.into(),
            };
            put("failureReason", failure);
            let u = p.get("usage")?;
            let cost = u.get("estimatedCostUsd")?.as_f64().filter(|c| *c >= 0.0)?;
            let usage = json!({
                "durationMs": int(u.get("durationMs"))?,
                "inputTokens": int(u.get("inputTokens"))?,
                "outputTokens": int(u.get("outputTokens"))?,
                "estimatedCostUsd": cost,
            });
            put("usage", usage);
        }
        "gate.completed" => {
            put("gate", code(p.get("gate"))?.into());
            put("status", one_of(GATE_STATUSES, text("status")?)?.into());
            put("durationMs", int(p.get("durationMs"))?.into());
        }
        "decision.recorded" => {
            let verdicts = "approve request_changes reject";
            put("verdict", one_of(verdicts, text("verdict")?)?.into());
        }
        "build.submitted" => put("headSha", sha?.into()),
        "verification.completed" => {
            put("headSha", sha?.into());
            put("passed", p.get("passed")?.as_bool()?.into());
        }
        _ => {}
    }
    Some(())
}

/// Comando que ve el webview: solo pasa el número. El trabajo bloqueante va a otro hilo.
#[tauri::command]
pub async fn read_task_activity(number: u64) -> ActivityRead {
    let Some(home) = home() else {
        return ActivityRead::Unreachable { reason: "no_home" };
    };
    tauri::async_runtime::spawn_blocking(move || activity_at(&home, number))
        .await
        .unwrap_or(ActivityRead::Unreachable { reason: "internal" })
}
