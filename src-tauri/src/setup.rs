// setup.rs
// 첫 실행 설치 오케스트레이션 - 비개발자가 터미널을 열 필요가 전혀 없도록
// Whisper 모델 다운로드 → Ollama 런타임 설치/기동 → LLM 모델 다운로드를 순서대로 처리.
//
// 각 단계는 "setup-progress" 이벤트로 진행 상황을 프론트에 스트리밍한다.
// 이미 다 준비된 상태(두 번째 실행부터)면 각 단계를 건너뛰고 빠르게 끝난다.

use crate::{ollama, transcribe};
use anyhow::Result;
use serde::Serialize;
use std::process::Child;
use tauri::{AppHandle, Emitter};

/// 프론트로 스트리밍되는 설치 진행 상태 - "setup-progress" 이벤트로 emit됨
#[derive(Debug, Clone, Serialize)]
pub struct SetupProgress {
    /// "downloading_whisper_model" | "downloading_ollama_runtime" | "extracting"
    /// | "starting_server" | "downloading_llm_model" | "ready"
    pub stage: String,
    pub message: String,
    /// 0.0~100.0, 진행률을 모를 땐 -1.0 (프론트에서 인디터미닛 스피너로 표시)
    pub percent: f32,
}

pub fn emit_progress(app: &AppHandle, stage: &str, message: &str, percent: f32) {
    let _ = app.emit(
        "setup-progress",
        SetupProgress {
            stage: stage.to_string(),
            message: message.to_string(),
            percent,
        },
    );
}

/// 전체 설치 오케스트레이션: Whisper 모델 확인/다운로드 → Ollama 런타임/서버/LLM 모델 준비
/// 반환된 Child(ollama serve 프로세스)는 호출자(AppState)가 보관하다가 앱 종료 시 kill해야 함
pub async fn run(app: &AppHandle) -> Result<Child> {
    transcribe::ensure_model_downloaded(app).await?;
    ollama::ensure_ready(app).await
}
