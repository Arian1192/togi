//! Cada fila de `list_tasks` trae su repo y su rama base (ADR-010 §2: la columna de proyectos agrupa
//! por repo). Son datos del daemon que se validan como en el detalle: un repo `owner/name`, una rama
//! en una línea, y nada que contenga el token.

use serde_json::{json, Value};
use std::io::{Read, Write};
use std::os::unix::net::UnixListener;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread::{self, JoinHandle};
use togi_desktop_lib::tasks::{tasks_at, TaskList};

const TOKEN: &str = "tok-centinela-7f3a9c41";
static NEXT: AtomicUsize = AtomicUsize::new(0);

fn home() -> PathBuf {
    let n = NEXT.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("tr-{}-{n}", std::process::id()));
    std::fs::create_dir_all(dir.join("run")).unwrap();
    std::fs::write(dir.join("credentials"), format!("{TOKEN}\n")).unwrap();
    dir
}

fn fake_daemon(home: &Path, body: String) -> JoinHandle<()> {
    let listener = UnixListener::bind(home.join("run").join("togi.sock")).unwrap();
    thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = Vec::new();
        let mut byte = [0; 1];
        while !request.ends_with(b"\r\n\r\n") {
            stream.read_exact(&mut byte).unwrap();
            request.push(byte[0]);
        }
        let head = format!(
            "HTTP/1.1 200 OK\r\ncontent-length: {}\r\n\r\n{body}",
            body.len()
        );
        stream.write_all(head.as_bytes()).unwrap();
    })
}

fn task(repo: &str, base: &str) -> Value {
    json!({
        "number": 1, "title": "Uno", "titleErased": false, "state": "draft", "risk": "low",
        "repo": repo, "baseBranch": base, "hasCriteria": true,
        "updatedAt": "2026-11-07T12:00:00.000Z", "version": 3
    })
}

fn ask(task: Value) -> Value {
    let home = home();
    let daemon = fake_daemon(&home, json!({ "tasks": [task] }).to_string());
    let list: TaskList = tasks_at(&home);
    daemon.join().unwrap();
    serde_json::to_value(&list).unwrap()
}

#[test]
fn la_fila_trae_el_repo_y_la_rama_base() {
    let json = ask(task("arian1192/togi", "feat/uno-2"));
    assert_eq!(json["status"], "ok");
    assert_eq!(json["tasks"][0]["repo"], "arian1192/togi");
    assert_eq!(json["tasks"][0]["baseBranch"], "feat/uno-2");
}

#[test]
fn un_repo_o_una_rama_fuera_de_contrato_invalidan_la_lista() {
    let bad = [
        task("togi", "main"),
        task("a/b/c", "main"),
        task("owner/na me", "main"),
        task("owner/name\n", "main"),
        task(&format!("owner/{TOKEN}"), "main"),
        task("owner/name", ""),
        task("owner/name", "ma\nin"),
        task("owner/name", &format!("rama-{TOKEN}")),
        task("owner/name", &"r".repeat(201)),
    ];
    for row in bad {
        let json = ask(row.clone());
        assert_eq!(
            json,
            json!({ "status": "unreachable", "reason": "bad_response" }),
            "{row}"
        );
    }
}
