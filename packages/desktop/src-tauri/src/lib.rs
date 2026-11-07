pub mod daemon;
pub mod events;
pub mod tasks;

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![daemon::get_daemon_status, tasks::list_tasks])
        .run(tauri::generate_context!())
        .expect("la app de togi no pudo arrancar");
}
