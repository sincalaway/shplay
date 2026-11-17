use tauri::Manager;

mod proxy;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            let proxy = proxy::start().map_err(std::io::Error::other)?;
            app.manage(proxy);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            proxy::prepare_media,
            proxy::fetch_provider_json
        ])
        .run(tauri::generate_context!())
        .expect("error while running shplay");
}
