fn main() {
    // Declarar los comandos aquí hace que cada uno necesite su permiso en una capacidad: sin
    // esto, Tauri deja invocar cualquier comando de la app desde el webview.
    let manifest = tauri_build::AppManifest::new().commands(&[
        "get_daemon_status",
        "list_tasks",
        "read_task",
        "watch_events",
        "read_plan",
        "approve_plan",
        "request_plan_changes",
        "reject_plan",
        "read_trajectory",
        "read_task_activity",
    ]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .expect("no se pudo preparar la app de Tauri");
}
