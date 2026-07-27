// ollama.rs
// Ollama 런타임 자동 설치 + 서버 기동/종료 + 모델 다운로드
//
// 비개발자 사용자가 터미널을 열 필요가 없도록, 앱이 알아서:
// 1) Ollama 실행 파일 번들(~146MB)을 ~/.wtf-english/ollama/ 에 내려받고
// 2) 백그라운드 서버로 띄운 뒤
// 3) 필요한 LLM 모델을 pull 하면서 진행률을 프론트로 스트리밍한다.
//
// 핵심 Rust 개념:
// - std::process::Command: 외부 프로세스 실행/관리
// - reqwest 스트리밍 + futures_util::StreamExt: 대용량 다운로드/NDJSON 진행률 추적

use crate::setup::emit_progress;
use anyhow::{Context, Result};
use futures_util::StreamExt;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use tauri::AppHandle;

const OLLAMA_DOWNLOAD_URL: &str = "https://ollama.com/download/ollama-darwin.tgz";
pub const OLLAMA_MODEL: &str = "llama3.1:8b";
const OLLAMA_API: &str = "http://localhost:11434";

/// ~/.wtf-english/ollama/ - 런타임(바이너리+dylib들) 설치 위치
pub fn get_ollama_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".wtf-english")
        .join("ollama")
}

pub fn get_ollama_binary_path() -> PathBuf {
    get_ollama_dir().join("ollama")
}

/// 다운로드한 모델(수 GB)은 런타임과 분리된 위치에 저장 - 런타임을 재설치해도 유지됨
fn get_ollama_models_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".wtf-english")
        .join("ollama-models")
}

pub fn is_ollama_installed() -> bool {
    get_ollama_binary_path().exists()
}

/// Ollama 런타임(바이너리 + dylib 번들) 다운로드 + 압축 해제
async fn install_ollama_runtime(app: &AppHandle) -> Result<()> {
    let dir = get_ollama_dir();
    std::fs::create_dir_all(&dir).context("Ollama 설치 디렉터리 생성 실패")?;

    let tgz_path = dir.join("ollama-darwin.tgz");

    emit_progress(app, "downloading_ollama_runtime", "Downloading Ollama…", 0.0);

    let client = reqwest::Client::new();
    let resp = client
        .get(OLLAMA_DOWNLOAD_URL)
        .send()
        .await
        .context("Ollama 런타임 다운로드 요청 실패")?;
    let total = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    let mut file = tokio::fs::File::create(&tgz_path)
        .await
        .context("임시 파일 생성 실패")?;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.context("다운로드 중 오류")?;
        tokio::io::AsyncWriteExt::write_all(&mut file, &chunk)
            .await
            .context("파일 쓰기 실패")?;
        downloaded += chunk.len() as u64;
        let percent = if total > 0 {
            (downloaded as f32 / total as f32) * 100.0
        } else {
            -1.0
        };
        emit_progress(app, "downloading_ollama_runtime", "Downloading Ollama…", percent);
    }
    drop(file);

    emit_progress(app, "extracting", "Setting things up…", -1.0);

    // macOS에는 항상 /usr/bin/tar가 있으므로 별도 압축 해제 크레이트 없이 시스템 tar 사용
    let status = Command::new("/usr/bin/tar")
        .args([
            "-xzf",
            tgz_path.to_str().context("경로가 유효한 UTF-8이 아닙니다")?,
            "-C",
            dir.to_str().context("경로가 유효한 UTF-8이 아닙니다")?,
        ])
        .status()
        .context("압축 해제 프로세스 실행 실패")?;

    let _ = std::fs::remove_file(&tgz_path);

    if !status.success() {
        anyhow::bail!("Ollama 런타임 압축 해제 실패 (tar exit code: {status})");
    }

    Ok(())
}

/// `ollama serve`를 백그라운드 프로세스로 기동
/// 반환된 Child는 호출자(AppState)가 보관하다가 앱 종료 시 kill해야 함
pub fn start_server() -> Result<Child> {
    let models_dir = get_ollama_models_dir();
    std::fs::create_dir_all(&models_dir).context("모델 저장 디렉터리 생성 실패")?;

    Command::new(get_ollama_binary_path())
        .arg("serve")
        .env("OLLAMA_MODELS", &models_dir)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .context("Ollama 서버 프로세스 시작 실패")
}

/// 서버가 요청을 받을 수 있을 때까지 대기 (최대 timeout_secs초, 0.5초 간격 폴링)
async fn wait_for_server_ready(timeout_secs: u64) -> bool {
    let client = reqwest::Client::new();
    for _ in 0..(timeout_secs * 2) {
        if client
            .get(format!("{OLLAMA_API}/api/version"))
            .send()
            .await
            .is_ok()
        {
            return true;
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    false
}

/// 지정한 모델이 이미 로컬에 받아져 있는지 확인
async fn is_model_present(model: &str) -> Result<bool> {
    let client = reqwest::Client::new();
    let body: serde_json::Value = client
        .get(format!("{OLLAMA_API}/api/tags"))
        .send()
        .await
        .context("Ollama 서버에 연결할 수 없습니다")?
        .json()
        .await
        .context("모델 목록 응답 파싱 실패")?;

    // "llama3.1:8b" 태그가 "llama3.1:8b" 또는 "llama3.1:latest" 등으로 저장될 수 있어
    // ':' 앞부분(모델 이름)만 우선 비교
    let base_name = model.split(':').next().unwrap_or(model);
    let models = body["models"].as_array().cloned().unwrap_or_default();
    Ok(models.iter().any(|m| {
        m["name"]
            .as_str()
            .map(|n| n.starts_with(base_name))
            .unwrap_or(false)
    }))
}

/// 모델을 pull하며 NDJSON 스트림으로 오는 진행률을 프론트로 emit
async fn pull_model(app: &AppHandle, model: &str) -> Result<()> {
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{OLLAMA_API}/api/pull"))
        .json(&serde_json::json!({ "model": model, "stream": true }))
        .send()
        .await
        .context("모델 다운로드 요청 실패")?;

    let mut stream = resp.bytes_stream();
    let mut buf = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.context("모델 다운로드 중 오류")?;
        buf.push_str(&String::from_utf8_lossy(&chunk));

        // Ollama pull API는 한 줄에 JSON 객체 하나씩(NDJSON) 스트리밍함
        while let Some(pos) = buf.find('\n') {
            let line = buf[..pos].trim().to_string();
            buf.drain(..=pos);
            if line.is_empty() {
                continue;
            }
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else {
                continue;
            };
            let status = v["status"].as_str().unwrap_or("").to_string();
            let completed = v["completed"].as_u64().unwrap_or(0);
            let total = v["total"].as_u64().unwrap_or(0);
            let percent = if total > 0 {
                (completed as f32 / total as f32) * 100.0
            } else {
                -1.0
            };
            emit_progress(app, "downloading_llm_model", &status, percent);
        }
    }

    Ok(())
}

/// 전체 오케스트레이션: 런타임 설치 → 서버 기동 → 모델 확인/다운로드
/// 이미 다 준비돼 있으면 각 단계를 건너뛰고 빠르게 "ready"로 끝남
pub async fn ensure_ready(app: &AppHandle) -> Result<Child> {
    if !is_ollama_installed() {
        install_ollama_runtime(app).await?;
    }

    emit_progress(app, "starting_server", "Starting local AI engine…", -1.0);
    let child = start_server()?;

    if !wait_for_server_ready(15).await {
        anyhow::bail!("Ollama 서버가 15초 내에 시작되지 않았습니다");
    }

    if !is_model_present(OLLAMA_MODEL).await? {
        emit_progress(app, "downloading_llm_model", "Downloading language model…", -1.0);
        pull_model(app, OLLAMA_MODEL).await?;
    }

    emit_progress(app, "ready", "Ready", 100.0);
    Ok(child)
}
