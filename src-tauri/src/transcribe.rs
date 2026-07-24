// transcribe.rs
// Whisper 로컬 STT (Speech-to-Text)
//
// 핵심 Rust 개념:
// - PathBuf: 파일시스템 경로 타입
// - Result<T, E>와 ? 연산자: 에러 전파
// - Option<T>: 값이 있을 수도 없을 수도 있는 타입

use anyhow::{Context, Result};
use std::path::PathBuf;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

/// Whisper 모델 저장 경로
/// 우선순위:
/// 1. 번들된 경로 (app.asar/resources/models/ggml-medium.en.bin) - DMG 설치
/// 2. 사용자 홈 경로 (~/.wtf-english/models/ggml-medium.en.bin) - 다운로드
pub fn get_model_path() -> PathBuf {
    // 번들된 모델 경로 (DMG 설치 시)
    let bundled_path = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|p| p.to_path_buf()))
        .map(|app_dir| app_dir.join("../Resources/models/ggml-medium.en.bin"))
        .filter(|p| p.exists());
    
    if let Some(path) = bundled_path {
        return path;
    }
    
    // 사용자 홈 경로 (다운로드)
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".wtf-english")
        .join("models")
        .join("ggml-medium.en.bin")
}

/// 모델 존재 여부 확인
pub fn is_model_ready() -> bool {
    get_model_path().exists()
}

/// 오디오 데이터(f32 샘플, 16kHz)를 텍스트로 변환
///
/// # 인자
/// * `audio` - 16kHz 모노 f32 샘플 배열
///
/// # 에러
/// 모델 파일 없음, Whisper 초기화 실패 등
pub fn transcribe(audio: &[f32]) -> Result<String> {
    let model_path = get_model_path();

    // Context::new_with_params: 모델을 한 번 로드 (무거운 작업)
    // 실제 앱에서는 전역으로 캐시하는 게 좋지만, 학습 목적으로 여기선 단순하게
    let ctx = WhisperContext::new_with_params(
        model_path
            .to_str()
            .context("모델 경로가 유효한 UTF-8이 아닙니다")?,
        WhisperContextParameters::default(),
    )
    .context("Whisper 모델 로드 실패")?;

    // State: 실제 추론에 사용되는 컨텍스트
    let mut state = ctx.create_state().context("Whisper 상태 생성 실패")?;

    // 추론 파라미터 설정
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some("en")); // 영어 고정
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);

    // 추론 실행
    state.full(params, audio).context("Whisper 추론 실패")?;

    // 결과 세그먼트 수집
    let n_segments = state.full_n_segments().context("세그먼트 수 조회 실패")?;

    let text: String = (0..n_segments)
        .filter_map(|i| state.full_get_segment_text(i).ok())
        .collect::<Vec<_>>()
        .join(" ");

    Ok(text.trim().to_string())
}

/// 모델 다운로드 안내 메시지 반환
pub fn model_download_instructions() -> String {
    let path = get_model_path();
    format!(
        "Whisper 모델이 없습니다.\n\n다음 명령어로 다운로드하세요:\n\nmkdir -p ~/.wtf-english/models\ncurl -L https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin \\\n  -o {:?}\n\n파일 크기: 약 1.5GB",
        path
    )
}
