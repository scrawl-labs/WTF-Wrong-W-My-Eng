mod audio;
mod commands;
mod feedback;
mod session;
mod transcribe;

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::check_setup,
            commands::start_session,
            commands::stop_session,
            commands::get_utterances,
            commands::get_transcript,
            commands::get_recording_status,
            commands::list_sessions,
            commands::get_stats,
            commands::get_session_info,
            commands::read_session,
            commands::read_session_utterances,
            commands::session_has_utterances_json,
            commands::read_session_transcript,
            commands::rename_session,
            commands::delete_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
