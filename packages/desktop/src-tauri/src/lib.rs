pub mod daemon;

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![daemon::get_daemon_status])
        .run(tauri::generate_context!())
        .expect("la app de togi no pudo arrancar");
}
