mod gnm_core;

use std::{
    path::PathBuf,
    process::Command,
    sync::OnceLock,
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use gnm_core::{GnmModel, GnmModelInfo};

static GNM_MODEL: OnceLock<Result<GnmModel, String>> = OnceLock::new();
static GNM_MODEL_BYTES: &[u8] = include_bytes!("../resources/gnm_head.npz");

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FfmpegProbe {
    available: bool,
    version: Option<String>,
    error: Option<String>,
}

fn quiet_command(program: &str) -> Command {
    let mut command = Command::new(program);
    #[cfg(target_os = "windows")]
    command.creation_flags(0x0800_0000);
    command
}

fn validate_temp_media_path(path: &str, extension: &str, must_exist: bool) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(path);
    if !candidate.is_absolute() {
        return Err("The temporary media path must be absolute.".into());
    }
    let file_name = candidate
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "The temporary media filename is invalid.".to_string())?;
    if !file_name.starts_with("gnm-studio-") || candidate.extension().and_then(|value| value.to_str()) != Some(extension) {
        return Err("The temporary media filename is outside the GNM Studio naming scope.".into());
    }
    let parent = candidate
        .parent()
        .ok_or_else(|| "The temporary media path has no parent directory.".to_string())?
        .canonicalize()
        .map_err(|error| format!("Could not resolve the temporary directory: {error}"))?;
    let temp = std::env::temp_dir()
        .canonicalize()
        .map_err(|error| format!("Could not resolve the Windows temporary directory: {error}"))?;
    if parent != temp {
        return Err("The media path must remain directly inside the Windows temporary directory.".into());
    }
    if must_exist && !candidate.is_file() {
        return Err("The temporary source recording does not exist.".into());
    }
    Ok(candidate)
}

fn runtime_model() -> Result<&'static GnmModel, String> {
    GNM_MODEL
        .get_or_init(|| GnmModel::from_bytes(GNM_MODEL_BYTES).map_err(|error| error.to_string()))
        .as_ref()
        .map_err(Clone::clone)
}

#[tauri::command]
fn gnm_model_info() -> Result<GnmModelInfo, String> {
    Ok(runtime_model()?.info())
}

#[tauri::command]
fn gnm_evaluate(
    identity: Vec<f32>,
    expression: Vec<f32>,
    rotations: Vec<[f32; 3]>,
    translation: [f32; 3],
) -> Result<Vec<[f32; 3]>, String> {
    runtime_model()?
        .evaluate(&identity, &expression, &rotations, translation)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn ffmpeg_probe(path: String) -> FfmpegProbe {
    let path = path.trim();
    if path.is_empty() {
        return FfmpegProbe { available: false, version: None, error: Some("No FFmpeg executable or PATH command was provided.".into()) };
    }
    match quiet_command(path).args(["-hide_banner", "-version"]).output() {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .unwrap_or("FFmpeg detected")
                .trim()
                .to_string();
            FfmpegProbe { available: true, version: Some(version), error: None }
        }
        Ok(output) => {
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
            FfmpegProbe {
                available: false,
                version: None,
                error: Some(if detail.is_empty() { format!("FFmpeg exited with {}.", output.status) } else { detail }),
            }
        }
        Err(error) => FfmpegProbe { available: false, version: None, error: Some(error.to_string()) },
    }
}

#[tauri::command]
fn ffmpeg_transcode(
    ffmpeg_path: String,
    input_path: String,
    output_path: String,
    video_bitrate_kbps: u32,
    audio_bitrate_kbps: u32,
) -> Result<(), String> {
    if !(1_000..=50_000).contains(&video_bitrate_kbps) {
        return Err("Video bitrate must be between 1,000 and 50,000 kbps.".into());
    }
    if !(64..=320).contains(&audio_bitrate_kbps) {
        return Err("Audio bitrate must be between 64 and 320 kbps.".into());
    }
    let input = validate_temp_media_path(&input_path, "webm", true)?;
    let output = validate_temp_media_path(&output_path, "mp4", false)?;
    if output.exists() {
        std::fs::remove_file(&output).map_err(|error| format!("Could not replace the temporary MP4: {error}"))?;
    }

    let video_bitrate = format!("{video_bitrate_kbps}k");
    let audio_bitrate = format!("{audio_bitrate_kbps}k");
    let result = quiet_command(ffmpeg_path.trim())
        .arg("-nostdin")
        .arg("-hide_banner")
        .args(["-loglevel", "error", "-y", "-i"])
        .arg(&input)
        .args(["-map", "0:v:0", "-map", "0:a:0?"])
        .args(["-c:v", "libx264", "-preset", "veryfast", "-b:v"])
        .arg(video_bitrate)
        .args(["-pix_fmt", "yuv420p", "-fps_mode", "passthrough"])
        .args(["-c:a", "aac", "-b:a"])
        .arg(audio_bitrate)
        .args(["-movflags", "+faststart"])
        .arg(&output)
        .output()
        .map_err(|error| format!("Could not start FFmpeg: {error}"))?;

    if !result.status.success() {
        let detail: String = String::from_utf8_lossy(&result.stderr).chars().take(4_000).collect();
        return Err(format!("FFmpeg exited with {}. {}", result.status, detail.trim()));
    }
    let size = std::fs::metadata(&output)
        .map_err(|error| format!("FFmpeg did not create the expected MP4: {error}"))?
        .len();
    if size == 0 {
        return Err("FFmpeg created an empty MP4 file.".into());
    }
    Ok(())
}

#[cfg(test)]
mod ffmpeg_tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn system_ffmpeg_transcodes_a_short_webm_when_available() {
        if !ffmpeg_probe("ffmpeg".into()).available {
            return;
        }
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let input = std::env::temp_dir().join(format!("gnm-studio-test-{nonce}.webm"));
        let output = std::env::temp_dir().join(format!("gnm-studio-test-{nonce}.mp4"));
        let generated = quiet_command("ffmpeg")
            .args(["-nostdin", "-hide_banner", "-loglevel", "error", "-y"])
            .args(["-f", "lavfi", "-i", "testsrc=size=160x120:rate=10"])
            .args(["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000"])
            .args(["-t", "0.35", "-c:v", "libvpx", "-c:a", "libopus"])
            .arg(&input)
            .status()
            .expect("test FFmpeg should start");
        assert!(generated.success());

        let result = ffmpeg_transcode(
            "ffmpeg".into(),
            input.to_string_lossy().into_owned(),
            output.to_string_lossy().into_owned(),
            2_000,
            128,
        );
        let output_size = std::fs::metadata(&output).map(|item| item.len()).unwrap_or(0);
        let _ = std::fs::remove_file(&input);
        let _ = std::fs::remove_file(&output);
        result.expect("system FFmpeg conversion should succeed");
        assert!(output_size > 1_000);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![gnm_model_info, gnm_evaluate, ffmpeg_probe, ffmpeg_transcode])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
