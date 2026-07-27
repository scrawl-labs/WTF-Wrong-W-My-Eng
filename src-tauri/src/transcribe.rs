// transcribe.rs
// Whisper 로컬 STT (Speech-to-Text)
//
// 핵심 Rust 개념:
// - PathBuf: 파일시스템 경로 타입
// - Result<T, E>와 ? 연산자: 에러 전파
// - Option<T>: 값이 있을 수도 없을 수도 있는 타입

use crate::setup::emit_progress;
use anyhow::{Context, Result};
use futures_util::StreamExt;
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::AppHandle;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

const WHISPER_MODEL_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin";

/// 로드된 Whisper 모델을 프로세스 전체에서 한 번만 로드해 재사용
/// (모델 로드는 1.5GB 파일을 읽는 무거운 작업 - 발화마다 새로 로드하면 수 초씩 지연됨)
static WHISPER_CTX: OnceLock<WhisperContext> = OnceLock::new();

/// 캐시된 WhisperContext를 반환하거나, 없으면 최초 1회 로드
fn get_or_init_context() -> Result<&'static WhisperContext> {
    if let Some(ctx) = WHISPER_CTX.get() {
        return Ok(ctx);
    }

    let model_path = get_model_path();
    let ctx = WhisperContext::new_with_params(
        model_path
            .to_str()
            .context("모델 경로가 유효한 UTF-8이 아닙니다")?,
        WhisperContextParameters::default(),
    )
    .context("Whisper 모델 로드 실패")?;

    // set()이 실패해도(다른 스레드가 동시에 먼저 로드) 문제 없음 - get()으로 재조회
    let _ = WHISPER_CTX.set(ctx);
    Ok(WHISPER_CTX.get().expect("방금 설정했으므로 항상 값이 존재함"))
}

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
    let ctx = get_or_init_context()?;

    // State: 실제 추론에 사용되는 컨텍스트 (호출마다 새로 생성 - 모델 자체는 캐시되어 공유됨)
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

/// Whisper 모델이 없으면 자동으로 다운로드 (비개발자가 터미널에서 curl을 직접
/// 칠 필요가 없도록). 이미 있으면 즉시 반환. 진행률은 "setup-progress" 이벤트로 emit됨.
pub async fn ensure_model_downloaded(app: &AppHandle) -> Result<()> {
    if is_model_ready() {
        return Ok(());
    }

    let path = get_model_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).context("모델 저장 디렉터리 생성 실패")?;
    }

    emit_progress(
        app,
        "downloading_whisper_model",
        "Downloading speech recognition model…",
        0.0,
    );

    let client = reqwest::Client::new();
    let resp = client
        .get(WHISPER_MODEL_URL)
        .send()
        .await
        .context("Whisper 모델 다운로드 요청 실패")?;
    let total = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    // 완료 전 중단되면 절반 받다 만 파일이 "설치됨"으로 오인되지 않도록 임시 경로에 받고 마지막에 옮김
    let tmp_path = path.with_extension("bin.downloading");
    let mut file = tokio::fs::File::create(&tmp_path)
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
        emit_progress(
            app,
            "downloading_whisper_model",
            "Downloading speech recognition model…",
            percent,
        );
    }
    drop(file);

    std::fs::rename(&tmp_path, &path).context("다운로드한 모델 파일 이동 실패")?;

    Ok(())
}

/// 모델 다운로드 안내 메시지 반환 - 자동 다운로드가 실패했을 때의 수동 폴백 안내
pub fn model_download_instructions() -> String {
    let path = get_model_path();
    format!(
        "Whisper 모델이 없습니다.\n\n다음 명령어로 다운로드하세요:\n\nmkdir -p ~/.wtf-english/models\ncurl -L https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin \\\n  -o {:?}\n\n파일 크기: 약 1.5GB",
        path
    )
}
