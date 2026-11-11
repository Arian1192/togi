pub mod activity;
pub mod daemon;
pub mod events;
pub mod plan;
pub mod tasks;
pub mod trajectory;

use tauri::Emitter;

pub fn run() {
    tauri::Builder::default()
        // Solo para el diálogo de confirmación desde Rust: la capacidad no da permisos de diálogo al webview.
        .plugin(tauri_plugin_dialog::init())
        // La barra de título la pinta la web (titleBarStyle Overlay). A pantalla completa macOS
        // oculta los semáforos y la barra deja de reservarles sitio. Lo avisa Rust: así la web no
        // necesita permiso para preguntar por la ventana.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Resized(_) = event {
                if let Ok(fullscreen) = window.is_fullscreen() {
                    let _ = window.emit("window-fullscreen", fullscreen);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            daemon::get_daemon_status,
            tasks::list_tasks,
            tasks::read_task,
            events::watch_events,
            plan::read_plan,
            plan::approve_plan,
            plan::request_plan_changes,
            plan::reject_plan,
            trajectory::read_trajectory,
            activity::read_task_activity
        ])
        .run(tauri::generate_context!())
        .expect("la app de togi no pudo arrancar");
}
