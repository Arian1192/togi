pub mod daemon;
pub mod events;
pub mod plan;
pub mod tasks;
pub mod trajectory;

pub fn run() {
    tauri::Builder::default()
        // Solo para el diálogo de confirmación desde Rust: la capacidad no da permisos de diálogo al webview.
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            daemon::get_daemon_status,
            tasks::list_tasks,
            tasks::read_task,
            events::watch_events,
            plan::read_plan,
            plan::approve_plan,
            plan::request_plan_changes,
            plan::reject_plan,
            trajectory::read_trajectory
        ])
        .run(tauri::generate_context!())
        .expect("la app de togi no pudo arrancar");
}
