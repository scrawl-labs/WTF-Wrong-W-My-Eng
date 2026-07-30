# Audio File Upload Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users upload an existing recording (m4a/mp3/wav) and get the same
markdown/JSON report a live mic session produces.

**Architecture:** A new Tauri command `start_session_from_file` decodes the uploaded
file with `symphonia`, resamples to 16kHz mono, transcribes it with Whisper using
Whisper's own segment timestamps (instead of the RMS-VAD used for live mic capture),
and then feeds the resulting utterances into a `finalize_session()` function extracted
from the existing `stop_session` command so both code paths produce reports identically.

**Tech Stack:** Rust (Tauri v2, symphonia, whisper-rs, tokio), React + TypeScript,
`@tauri-apps/plugin-dialog`.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-07-30-audio-file-upload-design.md` — follow it exactly; this plan implements it task by task.
- Supported upload formats: wav, mp3, m4a (AAC/isomp4). Use `symphonia = { version = "0.5", features = ["mp3", "aac", "isomp4", "wav"] }` — pure Rust, no bundled binaries.
- Whisper's own segment timestamps drive utterance splitting for uploads (not the RMS-VAD in `audio.rs`).
- Live mic sessions (`stop_session`) and uploads must share one report-generation function (`session::finalize_session`) — no duplicated LLM-feedback-loop/report-save logic.
- No file length/size cap. No batch upload (one file per call).
- JSON report schema (`Utterance`, `FeedbackResult`) must not change — only a new `.source` sidecar file is added, so old sessions stay readable.
- All new Rust code follows this file's existing convention of Korean doc comments (`///`) explaining non-obvious *why*, matching `audio.rs`/`session.rs`/`commands.rs` style.

---

### Task 1: Extract `dsp.rs` from `audio.rs`

**Files:**
- Create: `src-tauri/src/dsp.rs`
- Modify: `src-tauri/src/audio.rs` (remove `to_mono`/`resample`, import from `dsp`)
- Modify: `src-tauri/src/lib.rs:1-7` (add `mod dsp;`)

**Interfaces:**
- Produces: `pub fn to_mono(samples: &[f32], channels: u16) -> Vec<f32>`, `pub fn resample(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32>` — both moved verbatim from `audio.rs`, now `pub(crate)` visible to any module in the crate (used later by `decode.rs` in Task 3).

- [ ] **Step 1: Create `dsp.rs` with the moved functions and their existing unit-test-able behavior made explicit via new tests**

```rust
// dsp.rs
// 오디오 신호 처리 순수 함수 - 마이크 캡처(audio.rs)와 파일 디코딩(decode.rs)이 공유
//
// 핵심 Rust 개념:
// - 순수 함수: 입력만으로 출력이 결정되고 부작용이 없어 유닛 테스트가 쉬움

/// 스테레오(또는 멀티채널) → 모노 변환
/// 채널들의 평균값을 취함
pub fn to_mono(samples: &[f32], channels: u16) -> Vec<f32> {
    if channels == 1 {
        return samples.to_vec();
    }
    samples
        .chunks(channels as usize)
        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
        .collect()
}

/// 선형 보간 기반 리샘플링
/// from_rate → to_rate 로 변환
pub fn resample(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate {
        return samples.to_vec();
    }

    let ratio = from_rate as f64 / to_rate as f64;
    let output_len = (samples.len() as f64 / ratio) as usize;

    (0..output_len)
        .map(|i| {
            let src_pos = i as f64 * ratio;
            let floor = src_pos as usize;
            let ceil = (floor + 1).min(samples.len() - 1);
            let frac = (src_pos - floor as f64) as f32;
            samples[floor] * (1.0 - frac) + samples[ceil] * frac
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn to_mono_averages_stereo_frames() {
        // L=1.0,R=3.0 → 평균 2.0 / L=0.0,R=0.0 → 평균 0.0
        let stereo = vec![1.0, 3.0, 0.0, 0.0];
        assert_eq!(to_mono(&stereo, 2), vec![2.0, 0.0]);
    }

    #[test]
    fn to_mono_passthrough_when_already_mono() {
        let mono = vec![0.5, -0.5, 0.25];
        assert_eq!(to_mono(&mono, 1), mono);
    }

    #[test]
    fn resample_passthrough_when_rates_match() {
        let samples = vec![0.1, 0.2, 0.3];
        assert_eq!(resample(&samples, 16_000, 16_000), samples);
    }

    #[test]
    fn resample_halves_length_when_downsampling_by_half() {
        // 48000Hz → 16000Hz는 1/3 길이가 되어야 함 (48000/16000 = 3)
        let samples: Vec<f32> = (0..300).map(|i| i as f32).collect();
        let out = resample(&samples, 48_000, 16_000);
        assert_eq!(out.len(), 100);
    }
}
```

- [ ] **Step 2: Run the new tests to verify they pass**

Run: `cd src-tauri && cargo test --lib dsp::`
Expected: 4 tests pass (`to_mono_averages_stereo_frames`, `to_mono_passthrough_when_already_mono`, `resample_passthrough_when_rates_match`, `resample_halves_length_when_downsampling_by_half`)

- [ ] **Step 3: Remove the duplicated functions from `audio.rs` and import from `dsp`**

In `src-tauri/src/audio.rs`, delete the `to_mono` and `resample` function bodies (lines currently ~111-144, i.e. everything from `fn to_mono` through the end of `fn resample`), and add at the top of the file:

```rust
use crate::dsp::{resample, to_mono};
```

Leave `calculate_rms` in `audio.rs` — it's VAD-specific, not shared with the file-decode path.

- [ ] **Step 4: Register the new module**

In `src-tauri/src/lib.rs`, add `mod dsp;` alongside the existing `mod audio;` line (keep the list alphabetically ordered like the rest: `audio`, `commands`, `dsp`, `feedback`, `ollama`, `session`, `setup`, `transcribe`).

- [ ] **Step 5: Verify the whole crate still builds and existing behavior is unchanged**

Run: `cd src-tauri && cargo build`
Expected: builds with no errors (only pre-existing warnings, if any)

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/dsp.rs src-tauri/src/audio.rs src-tauri/src/lib.rs
git commit -m "refactor: extract dsp.rs (to_mono/resample) from audio.rs for reuse by file decoding"
```

---

### Task 2: Add `symphonia` and implement `decode.rs`

**Files:**
- Modify: `src-tauri/Cargo.toml` (add `symphonia` dependency)
- Create: `src-tauri/src/decode.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod decode;`)

**Interfaces:**
- Consumes: `dsp::to_mono(samples: &[f32], channels: u16) -> Vec<f32>`, `dsp::resample(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32>` (Task 1).
- Produces: `pub fn decode_file_to_pcm16k(path: &std::path::Path) -> anyhow::Result<Vec<f32>>` — used by `commands::start_session_from_file` in Task 5. Also exposes `pub const WHISPER_SAMPLE_RATE: u32 = 16_000;` (mirrors the constant already private in `audio.rs`; `decode.rs` owns its own copy since it's the "file → PCM" boundary, not audio capture).

- [ ] **Step 1: Add the `symphonia` dependency**

In `src-tauri/Cargo.toml`, under the `# Audio capture` section, add:

```toml
# 파일 업로드 오디오 디코딩 (wav/mp3/m4a) - 순수 Rust, 외부 바이너리 불필요
symphonia = { version = "0.5", features = ["mp3", "aac", "isomp4", "wav"] }
```

- [ ] **Step 2: Write `decode.rs`**

```rust
// decode.rs
// 업로드된 오디오 파일(wav/mp3/m4a)을 Whisper가 기대하는 16kHz 모노 PCM으로 디코딩
//
// 핵심 Rust 개념:
// - symphonia: 순수 Rust 오디오 디코딩 라이브러리 (포맷 자동 감지 + 코덱 디코딩)
// - SampleBuffer: 어떤 원본 샘플 포맷(u8/s16/f32/...)이든 f32 인터리브 배열로 통일

use crate::dsp;
use anyhow::{anyhow, Context, Result};
use std::fs::File;
use std::path::Path;
use symphonia::core::audio::{AudioBufferRef, SampleBuffer};
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

/// Whisper가 기대하는 샘플레이트 (audio.rs의 상수와 동일한 값이지만, 이 모듈은
/// "파일 → PCM" 경계를 독립적으로 소유하므로 별도로 정의)
pub const WHISPER_SAMPLE_RATE: u32 = 16_000;

/// 오디오 파일(wav/mp3/m4a)을 16kHz 모노 f32 PCM으로 디코딩
///
/// # 에러
/// 파일을 열 수 없거나, 포맷을 인식할 수 없거나, 오디오 트랙이 없거나,
/// 디코딩된 샘플이 하나도 없을 때
pub fn decode_file_to_pcm16k(path: &Path) -> Result<Vec<f32>> {
    let file = File::open(path).with_context(|| format!("파일을 열 수 없습니다: {path:?}"))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .context("오디오 포맷을 인식할 수 없습니다 (지원 포맷: wav, mp3, m4a)")?;

    let mut format = probed.format;

    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| anyhow!("오디오 트랙을 찾을 수 없습니다"))?
        .clone();

    let track_id = track.id;
    let source_rate = track
        .codec_params
        .sample_rate
        .ok_or_else(|| anyhow!("샘플레이트 정보를 읽을 수 없습니다"))?;
    let channels = track
        .codec_params
        .channels
        .map(|c| c.count() as u16)
        .ok_or_else(|| anyhow!("채널 정보를 읽을 수 없습니다"))?;

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .context("디코더를 생성할 수 없습니다")?;

    // 인터리브된 f32 샘플을 여기 누적 - SampleBuffer가 원본 포맷(u8/s16/f32/...)
    // 무엇이든 f32로 자동 변환해줘서 포맷별 분기 없이 처리 가능
    let mut samples: Vec<f32> = Vec::new();
    let mut sample_buf: Option<SampleBuffer<f32>> = None;

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            // 파일 끝 - 정상 종료
            Err(SymphoniaError::IoError(ref e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(e) => return Err(e).context("오디오 패킷 읽기 실패"),
        };

        if packet.track_id() != track_id {
            continue;
        }

        let decoded: AudioBufferRef = match decoder.decode(&packet) {
            Ok(d) => d,
            // 개별 패킷 손상은 건너뛰고 계속 - 파일 전체를 실패시키지 않음
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(e) => return Err(e).context("오디오 디코딩 실패"),
        };

        if sample_buf.is_none() {
            let spec = *decoded.spec();
            let duration = decoded.capacity() as u64;
            sample_buf = Some(SampleBuffer::<f32>::new(duration, spec));
        }

        if let Some(buf) = &mut sample_buf {
            buf.copy_interleaved_ref(decoded);
            samples.extend_from_slice(buf.samples());
        }
    }

    if samples.is_empty() {
        return Err(anyhow!("오디오 데이터를 읽지 못했습니다 (빈 파일이거나 지원하지 않는 코덱)"));
    }

    let mono = dsp::to_mono(&samples, channels);
    Ok(dsp::resample(&mono, source_rate, WHISPER_SAMPLE_RATE))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// 테스트용 440Hz 사인파 wav 파일을 임시 경로에 생성 (hound는 이미 프로젝트
    /// 의존성이라 추가 크레이트 없이 픽스처를 즉석에서 만들 수 있음)
    fn write_test_wav(path: &Path, sample_rate: u32, channels: u16, seconds: f32) {
        let spec = hound::WavSpec {
            channels,
            sample_rate,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::create(path, spec).unwrap();
        let total_samples = (sample_rate as f32 * seconds) as usize;
        for i in 0..total_samples {
            let t = i as f32 / sample_rate as f32;
            let value = (t * 440.0 * std::f32::consts::TAU).sin();
            let amplitude = (value * i16::MAX as f32) as i16;
            for _ in 0..channels {
                writer.write_sample(amplitude).unwrap();
            }
        }
        writer.finalize().unwrap();
    }

    #[test]
    fn decodes_mono_wav_to_16k_pcm() {
        let dir = std::env::temp_dir();
        let path = dir.join("wtf_english_test_mono.wav");
        write_test_wav(&path, 16_000, 1, 0.5);

        let pcm = decode_file_to_pcm16k(&path).unwrap();

        // 0.5초 @ 16kHz ≈ 8000 샘플 (리샘플링 없음이므로 정확히 일치)
        assert_eq!(pcm.len(), 8_000);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn decodes_and_resamples_stereo_48k_wav() {
        let dir = std::env::temp_dir();
        let path = dir.join("wtf_english_test_stereo_48k.wav");
        write_test_wav(&path, 48_000, 2, 0.5);

        let pcm = decode_file_to_pcm16k(&path).unwrap();

        // 48kHz → 16kHz는 1/3 길이, 0.5초 @ 48kHz = 24000 샘플 → 8000 샘플
        assert_eq!(pcm.len(), 8_000);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn errors_on_missing_file() {
        let result = decode_file_to_pcm16k(Path::new("/nonexistent/path/does-not-exist.wav"));
        assert!(result.is_err());
    }
}
```

- [ ] **Step 3: Register the module**

In `src-tauri/src/lib.rs`, add `mod decode;` to the `mod` list.

- [ ] **Step 4: Run the tests**

Run: `cd src-tauri && cargo test --lib decode::`
Expected: `decodes_mono_wav_to_16k_pcm`, `decodes_and_resamples_stereo_48k_wav`, `errors_on_missing_file` all pass

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/decode.rs src-tauri/src/lib.rs
git commit -m "feat: decode uploaded audio files (wav/mp3/m4a) to 16kHz PCM via symphonia"
```

---

### Task 3: Add `transcribe_with_segments` with timestamps and progress

**Files:**
- Modify: `src-tauri/src/transcribe.rs`

**Interfaces:**
- Consumes: nothing new (uses the existing `get_or_init_context()` in the same file).
- Produces:
  ```rust
  pub struct TranscribedSegment {
      pub text: String,
      pub start_secs: f32,
      pub end_secs: f32,
  }

  pub fn transcribe_with_segments(
      audio: &[f32],
      on_progress: impl FnMut(i32) + 'static,
  ) -> anyhow::Result<Vec<TranscribedSegment>>
  ```
  Used by `commands::start_session_from_file` in Task 5.

- [ ] **Step 1: Add the struct and function to `transcribe.rs`**

Add this after the existing `transcribe()` function (leave `transcribe()` itself untouched — it's still used by the live-mic VAD path):

```rust
/// Whisper 세그먼트 하나 - 텍스트 + 파일 시작 기준 시작/종료 시각(초)
#[derive(Debug, Clone)]
pub struct TranscribedSegment {
    pub text: String,
    pub start_secs: f32,
    pub end_secs: f32,
}

/// 오디오 파일 전체(16kHz 모노)를 한 번에 전사하고, Whisper 자체 세그먼트
/// 타임스탬프로 발화 단위를 나눠 반환한다.
///
/// 라이브 마이크 캡처는 RMS 기반 VAD(audio.rs)로 이미 발화 단위가 나뉜 짧은
/// 청크만 `transcribe()`에 넘기지만, 업로드 파일은 통째로 넘기고 Whisper가
/// 내부적으로 발화를 세그먼트로 나누게 한다 - 파일 전체 문맥을 보고 나누므로
/// 우리 RMS 임계값보다 정확하고, 긴 파일도 한 번의 모델 로드/추론으로 처리된다.
///
/// # 인자
/// * `audio` - 16kHz 모노 f32 샘플 전체
/// * `on_progress` - 0~100 진행률 콜백 (whisper.cpp가 내부적으로 호출)
///
/// # 에러
/// 모델 로드 실패, Whisper 추론 실패, 세그먼트 조회 실패
pub fn transcribe_with_segments(
    audio: &[f32],
    on_progress: impl FnMut(i32) + 'static,
) -> Result<Vec<TranscribedSegment>> {
    let ctx = get_or_init_context()?;
    let mut state = ctx.create_state().context("Whisper 상태 생성 실패")?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some("en"));
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_progress_callback_safe(on_progress);

    state.full(params, audio).context("Whisper 추론 실패")?;

    let n_segments = state.full_n_segments().context("세그먼트 수 조회 실패")?;

    let mut segments = Vec::with_capacity(n_segments as usize);
    for i in 0..n_segments {
        let text = state
            .full_get_segment_text(i)
            .context("세그먼트 텍스트 조회 실패")?
            .trim()
            .to_string();
        if text.is_empty() {
            continue;
        }
        // t0/t1은 10ms 단위(centisecond)로 반환됨 - 초 단위로 변환
        let t0 = state.full_get_segment_t0(i).context("세그먼트 시작 시각 조회 실패")?;
        let t1 = state.full_get_segment_t1(i).context("세그먼트 종료 시각 조회 실패")?;

        segments.push(TranscribedSegment {
            text,
            start_secs: t0 as f32 / 100.0,
            end_secs: t1 as f32 / 100.0,
        });
    }

    Ok(segments)
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd src-tauri && cargo build`
Expected: builds successfully (no test here yet — this function needs the 1.5GB Whisper model on disk to run for real, so it's exercised end-to-end in Task 6's manual verification instead of a unit test)

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/transcribe.rs
git commit -m "feat: add transcribe_with_segments for timestamp-based utterance splitting"
```

---

### Task 4: `SessionSource` + extract `finalize_session` in `session.rs`

**Files:**
- Modify: `src-tauri/src/session.rs`

**Interfaces:**
- Consumes: `feedback::get_feedback(text: &str) -> Result<FeedbackResult>` (existing), `tauri::AppHandle`, `tauri::Emitter` (existing crate, already used in `setup.rs`).
- Produces:
  ```rust
  #[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
  #[serde(tag = "kind", rename_all = "snake_case")]
  pub enum SessionSource {
      Recorded,
      Uploaded { original_filename: String },
  }

  pub async fn finalize_session(
      app: &tauri::AppHandle,
      raw_utterances: &[RawUtterance],
      start_time: &DateTime<Local>,
      source: SessionSource,
  ) -> Result<String>
  ```
  Used by `commands::stop_session` (modified in Task 5) and `commands::start_session_from_file` (new in Task 5).
  `SessionInfo` gains a `pub source: SessionSource` field, consumed by the frontend `SessionInfo` type (Task 8).

- [ ] **Step 1: Add `SessionSource` and the sidecar read/write helpers**

Add near the top of `session.rs`, after the `RawUtterance` struct:

```rust
/// 세션이 라이브 녹음으로 만들어졌는지, 파일 업로드로 만들어졌는지
/// `<base>.source` 사이드카 파일로 저장됨 (.title/.txt와 동일한 패턴)
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SessionSource {
    Recorded,
    Uploaded { original_filename: String },
}

/// `<base>.source` 사이드카에 세션 출처를 저장
fn save_source_sidecar(md_path: &PathBuf, source: &SessionSource) -> Result<()> {
    let path = md_path.with_extension("source");
    let content = match source {
        SessionSource::Recorded => "recorded".to_string(),
        SessionSource::Uploaded { original_filename } => {
            format!("uploaded\n{original_filename}")
        }
    };
    std::fs::write(path, content)?;
    Ok(())
}

/// `<base>.source` 사이드카를 읽음 - 없으면(과거 세션) Recorded로 취급
fn read_source_sidecar(md_path: &PathBuf) -> SessionSource {
    let path = md_path.with_extension("source");
    let Ok(content) = std::fs::read_to_string(path) else {
        return SessionSource::Recorded;
    };
    let mut lines = content.lines();
    match lines.next() {
        Some("uploaded") => SessionSource::Uploaded {
            original_filename: lines.next().unwrap_or("").to_string(),
        },
        _ => SessionSource::Recorded,
    }
}
```

- [ ] **Step 2: Add the progress event struct**

```rust
/// 리포트 생성(발화별 LLM 피드백) 진행률 - "session-progress" 이벤트로 emit됨
#[derive(Debug, Clone, Serialize)]
struct SessionProgress {
    stage: String, // "generating_feedback"
    current: usize,
    total: usize,
}
```

- [ ] **Step 3: Extract `finalize_session`**

Add this function to `session.rs` (it needs `use tauri::{AppHandle, Emitter};` added to the file's imports, and `use crate::feedback;`):

```rust
/// 전문(raw_utterances)을 바탕으로 발화별 LLM 피드백을 일괄 생성하고 리포트를
/// 저장한다. 라이브 녹음(stop_session)과 파일 업로드(start_session_from_file)가
/// 이 함수 하나를 공유해서 리포트 생성 로직이 완전히 하나로 유지된다.
///
/// # 반환값
/// 저장된 마크다운 파일의 절대 경로 (문자열)
pub async fn finalize_session(
    app: &AppHandle,
    raw_utterances: &[RawUtterance],
    start_time: &DateTime<Local>,
    source: SessionSource,
) -> Result<String> {
    // 전문(.txt)은 피드백 생성 여부와 무관하게 먼저 저장 - 실패해도 원문은 남도록
    if let Err(e) = save_transcript(raw_utterances, start_time) {
        eprintln!("[Session] 전문 저장 실패: {e}");
    }

    let total = raw_utterances.len();
    let mut utterances = Vec::with_capacity(total);
    for (i, raw) in raw_utterances.iter().enumerate() {
        let _ = app.emit(
            "session-progress",
            SessionProgress {
                stage: "generating_feedback".to_string(),
                current: i + 1,
                total,
            },
        );

        match feedback::get_feedback(&raw.text).await {
            Ok(fb) => utterances.push(Utterance {
                timestamp: raw.timestamp.clone(),
                feedback: fb,
            }),
            Err(e) => {
                eprintln!("[Feedback] \"{}\" 처리 실패: {e}", raw.text);
                utterances.push(Utterance {
                    timestamp: raw.timestamp.clone(),
                    feedback: FeedbackResult {
                        original: raw.text.clone(),
                        corrected: None,
                        better_expression: None,
                        idiom_or_vocab: None,
                        has_error: false,
                    },
                });
            }
        }
    }

    let path = save_report(&utterances, start_time)?;
    if let Err(e) = save_source_sidecar(&path, &source) {
        eprintln!("[Session] 출처 사이드카 저장 실패: {e}");
    }

    Ok(path.to_string_lossy().to_string())
}
```

Also add `use crate::feedback::{self, FeedbackResult};` at the top if not already imported (currently `session.rs` imports `use crate::feedback::FeedbackResult;` only — change it to also bring in the `feedback` module itself: `use crate::feedback::{self, FeedbackResult};`).

- [ ] **Step 4: Add `source` to `SessionInfo` and populate it in `list_sessions`/`get_session_info`**

In the `SessionInfo` struct definition, add the field:

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SessionInfo {
    pub filename: String,
    pub title: String,
    pub path: String,
    pub source: SessionSource,
}
```

In `list_sessions()`, where `SessionInfo` is constructed, add `source: read_source_sidecar(&path),`.

In `get_session_info()`, add `source: read_source_sidecar(&path),` to the returned `SessionInfo`.

- [ ] **Step 5: Verify the crate still builds**

Run: `cd src-tauri && cargo build`
Expected: fails at this point because `commands.rs` still calls the old inline logic in `stop_session` and doesn't yet construct `SessionInfo` with the new `source` field in a way that compiles — that's expected and fixed in Task 5. If `session.rs` itself has a syntax/type error unrelated to `commands.rs` callers, fix that now; a "missing field `source`" or "unresolved" error pointing into `commands.rs` is expected and deferred to Task 5.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/session.rs
git commit -m "refactor: extract finalize_session and add SessionSource tracking"
```

(Note: this commit will not build in isolation because `commands.rs` hasn't been updated yet — that's fine, Task 5 fixes it immediately after. If your workflow requires every commit to build, squash Tasks 4 and 5 into one commit instead.)

---

### Task 5: Wire `finalize_session` into `stop_session` + add `start_session_from_file`

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs` (register new command)

**Interfaces:**
- Consumes: `decode::decode_file_to_pcm16k` (Task 2), `transcribe::transcribe_with_segments` (Task 3), `session::finalize_session`, `session::SessionSource`, `session::RawUtterance` (Task 4).
- Produces: new Tauri command `start_session_from_file(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<String, String>`, consumed by the frontend in Task 8.

- [ ] **Step 1: Update `stop_session` to use `finalize_session`**

Replace the body of `stop_session` from the line `let raw_utterances = state.raw_utterances.lock().unwrap().clone();` through the end of the function with:

```rust
    let raw_utterances = state.raw_utterances.lock().unwrap().clone();
    let session_start = state.session_start.lock().unwrap().clone();

    let Some(start) = session_start else {
        return Ok(String::new());
    };

    let path = session::finalize_session(
        &app,
        &raw_utterances,
        &start,
        session::SessionSource::Recorded,
    )
    .await
    .map_err(|e| e.to_string())?;

    *state.utterances.lock().unwrap() = session::read_utterances(&path).unwrap_or_default();

    Ok(path)
```

Update the `stop_session` signature to accept `app: AppHandle` (Tauri auto-injects it, same as `run_setup` already does):

```rust
#[tauri::command]
pub async fn stop_session(app: AppHandle, state: State<'_, AppState>) -> Result<String, String> {
```

- [ ] **Step 2: Add `start_session_from_file`**

Add this new command to `commands.rs`, near `start_session`:

```rust
/// 업로드된 오디오 파일로부터 세션 생성 - 마이크 캡처 없이 파일 하나를
/// 디코딩 → 전사(세그먼트 타임스탬프) → 피드백 생성까지 한 번에 처리한다.
/// 라이브 세션과 달리 시작/종료 단계가 없고, 이 커맨드 하나가 끝나면
/// 바로 완성된 리포트 경로를 반환한다.
#[tauri::command]
pub async fn start_session_from_file(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<String, String> {
    if state.is_recording.load(Ordering::SeqCst) {
        return Err("이미 세션이 진행 중입니다".to_string());
    }

    if !transcribe::is_model_ready() {
        return Err(transcribe::model_download_instructions());
    }

    let file_path = std::path::PathBuf::from(&path);
    let original_filename = file_path
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());

    let app_for_decode = app.clone();
    let pcm = tauri::async_runtime::spawn_blocking(move || {
        let _ = app_for_decode.emit(
            "session-progress",
            serde_json::json!({ "stage": "decoding_audio", "current": 0, "total": 0 }),
        );
        crate::decode::decode_file_to_pcm16k(&file_path)
    })
    .await
    .map_err(|e| format!("디코딩 작업 실패: {e}"))?
    .map_err(|e| e.to_string())?;

    let app_for_transcribe = app.clone();
    let segments = tauri::async_runtime::spawn_blocking(move || {
        crate::transcribe::transcribe_with_segments(&pcm, move |percent| {
            let _ = app_for_transcribe.emit(
                "session-progress",
                serde_json::json!({ "stage": "transcribing", "current": percent, "total": 100 }),
            );
        })
    })
    .await
    .map_err(|e| format!("전사 작업 실패: {e}"))?
    .map_err(|e| e.to_string())?;

    if segments.is_empty() {
        return Err("인식된 발화가 없습니다".to_string());
    }

    let raw_utterances: Vec<session::RawUtterance> = segments
        .into_iter()
        .map(|seg| session::RawUtterance {
            timestamp: format_offset_timestamp(seg.start_secs),
            text: seg.text,
        })
        .collect();

    *state.raw_utterances.lock().unwrap() = raw_utterances.clone();

    let start = chrono::Local::now();
    let report_path = session::finalize_session(
        &app,
        &raw_utterances,
        &start,
        session::SessionSource::Uploaded { original_filename },
    )
    .await
    .map_err(|e| e.to_string())?;

    *state.utterances.lock().unwrap() =
        session::read_utterances(&report_path).unwrap_or_default();

    Ok(report_path)
}

/// 파일 시작 기준 경과 시간(초)을 "mm:ss" 형식으로 포맷
/// 라이브 세션의 타임스탬프(HH:MM:SS 벽시계 시각)와 의미가 다름 - 업로드 세션은
/// "몇 분 몇 초 지점의 발화인가"가 사용자에게 더 유용함
fn format_offset_timestamp(seconds: f32) -> String {
    let total_secs = seconds.max(0.0) as u64;
    format!("{:02}:{:02}", total_secs / 60, total_secs % 60)
}
```

- [ ] **Step 3: Register the command**

In `src-tauri/src/lib.rs`, add `commands::start_session_from_file,` to the `invoke_handler(tauri::generate_handler![...])` list, right after `commands::start_session,`.

- [ ] **Step 4: Build**

Run: `cd src-tauri && cargo build`
Expected: builds successfully. This also validates Task 4's `session.rs` changes compile now that `commands.rs` uses them.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add start_session_from_file command, share report generation via finalize_session"
```

---

### Task 6: Add the dialog plugin (Rust + npm) and capability

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `package.json`

**Interfaces:**
- Produces: the `open` function from `@tauri-apps/plugin-dialog`, consumed by `UploadModal.tsx` in Task 7.

- [ ] **Step 1: Add the Rust plugin dependency**

In `src-tauri/Cargo.toml`, add near the other `tauri-plugin-*` line:

```toml
tauri-plugin-dialog = "2"
```

- [ ] **Step 2: Register the plugin**

In `src-tauri/src/lib.rs`, add `.plugin(tauri_plugin_dialog::init())` to the builder chain, next to the existing `.plugin(tauri_plugin_macos_permissions::init())` line.

- [ ] **Step 3: Grant the capability**

In `src-tauri/capabilities/default.json`, add `"dialog:default"` to the `permissions` array, so it reads:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "opener:default",
    "macos-permissions:default",
    "dialog:default"
  ]
}
```

- [ ] **Step 4: Add the npm package**

Run: `cd /Users/taek/Desktop/yongtaek/wtf-is-wrong-with-your-english && npm install @tauri-apps/plugin-dialog@^2`

- [ ] **Step 5: Build to confirm the Rust side compiles with the new plugin**

Run: `cd src-tauri && cargo build`
Expected: builds successfully

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/capabilities/default.json package.json package-lock.json
git commit -m "feat: add tauri-plugin-dialog for native file picker"
```

---

### Task 7: Frontend types + `UploadModal.tsx`

**Files:**
- Modify: `src/types/index.ts`
- Create: `src/components/UploadModal.tsx`

**Interfaces:**
- Produces:
  ```ts
  export type SessionSource =
    | { kind: "recorded" }
    | { kind: "uploaded"; original_filename: string };

  export interface SessionProgress {
    stage: "decoding_audio" | "transcribing" | "generating_feedback";
    current: number;
    total: number;
  }
  ```
  and the `UploadModal` component, both consumed by `App.tsx` and `SessionList.tsx` in Task 8.
- Consumes: `@tauri-apps/plugin-dialog`'s `open()`, `@tauri-apps/api/window`'s `getCurrentWindow()` (for native drag-and-drop file paths — Tauri's webview intercepts OS-level file drops and does not deliver real file paths through plain HTML5 `ondrop`).

- [ ] **Step 1: Add the new types**

In `src/types/index.ts`, add:

```ts
// 세션이 라이브 녹음으로 만들어졌는지, 파일 업로드로 만들어졌는지
export type SessionSource =
  | { kind: "recorded" }
  | { kind: "uploaded"; original_filename: string };

// 파일 업로드 세션 처리 진행 상태 - "session-progress" 이벤트 페이로드
// (라이브 세션의 stop_session도 "generating_feedback" 단계를 emit하지만,
//  현재 프론트에서는 업로드 모달에서만 구독함)
export interface SessionProgress {
  stage: "decoding_audio" | "transcribing" | "generating_feedback";
  current: number;
  total: number;
}
```

- [ ] **Step 2: Write `UploadModal.tsx`**

```tsx
// src/components/UploadModal.tsx
// 녹음 파일 업로드 모달 - 드래그앤드롭 영역 + 네이티브 파일 선택 버튼
//
// Tauri 웹뷰는 기본적으로 OS 레벨 파일 드롭을 가로채서 브라우저의 HTML5
// ondrop 이벤트에는 실제 파일 경로가 전달되지 않는다. 대신
// getCurrentWindow().onDragDropEvent()로 받아야 한다.

import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { XMarkIcon, DocumentArrowUpIcon } from "@heroicons/react/20/solid";
import { SessionProgress } from "../types";

const SUPPORTED_EXTENSIONS = ["wav", "mp3", "m4a"];

interface UploadModalProps {
  onClose: () => void;
  onUpload: (path: string) => void;
  processing: boolean;
  progress: SessionProgress | null;
  error: string;
}

export function UploadModal({
  onClose,
  onUpload,
  processing,
  progress,
  error,
}: UploadModalProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => {
    const unlisten = getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type === "over") {
        setIsDragOver(true);
      } else if (event.payload.type === "drop") {
        setIsDragOver(false);
        const first = event.payload.paths[0];
        if (first && isSupported(first)) {
          onUpload(first);
        }
      } else {
        setIsDragOver(false);
      }
    });
    return () => {
      unlisten.then((u) => u());
    };
  }, [onUpload]);

  const isSupported = (path: string) => {
    const ext = path.split(".").pop()?.toLowerCase();
    return !!ext && SUPPORTED_EXTENSIONS.includes(ext);
  };

  const handlePickFile = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Audio", extensions: SUPPORTED_EXTENSIONS }],
    });
    if (typeof selected === "string") {
      onUpload(selected);
    }
  };

  const progressLabel = (p: SessionProgress) => {
    if (p.stage === "decoding_audio") return "Decoding audio…";
    if (p.stage === "transcribing") return `Transcribing… ${p.current}%`;
    return `Generating feedback… ${p.current}/${p.total}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 dark:border-zinc-800">
          <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Upload a recording
          </h2>
          {!processing && (
            <button
              onClick={onClose}
              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              <XMarkIcon className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="p-5">
          {error && (
            <p className="text-xs text-red-600 dark:text-red-400 mb-3 whitespace-pre-wrap">
              {error}
            </p>
          )}

          {processing ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <DocumentArrowUpIcon className="w-8 h-8 text-zinc-300 dark:text-zinc-700 animate-pulse" />
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {progress ? progressLabel(progress) : "Starting…"}
              </p>
            </div>
          ) : (
            <button
              onClick={handlePickFile}
              className={`w-full flex flex-col items-center gap-3 py-10 border-2 border-dashed rounded-lg transition-colors cursor-pointer ${
                isDragOver
                  ? "border-zinc-400 dark:border-zinc-500 bg-zinc-50 dark:bg-zinc-800"
                  : "border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600"
              }`}
            >
              <DocumentArrowUpIcon className="w-8 h-8 text-zinc-300 dark:text-zinc-700" />
              <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center px-6">
                Drag a recording here, or click to choose a file
                <br />
                <span className="text-xs text-zinc-400 dark:text-zinc-600">
                  wav, mp3, m4a
                </span>
              </p>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npm run build`
Expected: `tsc` passes (the component isn't imported anywhere yet, so it must still type-check standalone — any unused-export warnings are fine, unused-import errors are not)

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts src/components/UploadModal.tsx
git commit -m "feat: add UploadModal component and SessionSource/SessionProgress types"
```

---

### Task 8: Wire the upload flow into `App.tsx` and `SessionList.tsx`

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/SessionList.tsx`

**Interfaces:**
- Consumes: `UploadModal` (Task 7), `SessionSource`/`SessionProgress` types (Task 7), `start_session_from_file` command (Task 5), `session-progress` event (Task 4/5).

- [ ] **Step 1: Add `source` to the `SessionInfo` interface in `SessionList.tsx`**

```ts
import { SessionSource } from "../types";

export interface SessionInfo {
  filename: string;
  title: string;
  path: string;
  source: SessionSource;
}
```

- [ ] **Step 2: Show a badge for uploaded sessions in the session list**

In `SessionList.tsx`, inside the `<li>` render block (around where `session.title` and `session.filename` are shown, in the `<button onClick={() => onSelectSession(session)}>`), change:

```tsx
<div className="font-medium truncate">{session.title}</div>
```

to:

```tsx
<div className="font-medium truncate flex items-center gap-1.5">
  {session.title}
  {session.source.kind === "uploaded" && (
    <span
      title={`Uploaded: ${session.source.original_filename}`}
      className="shrink-0 text-[9px] font-semibold uppercase tracking-wide px-1 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-300"
    >
      File
    </span>
  )}
</div>
```

- [ ] **Step 3: Add an "Upload" button next to "New Session" in `SessionList.tsx`**

Add a new prop `onUploadClick: () => void` to `SessionListProps` and the destructured props, then change the button block (currently a single `<button onClick={onNewSession}>`) to a two-button row:

```tsx
{/* 새 세션 버튼 - 녹음 시작 또는 파일 업로드 */}
<div className={`pt-3 shrink-0 flex gap-1.5 ${collapsed ? "px-1.5 flex-col" : "px-2"}`}>
  <button
    onClick={onNewSession}
    disabled={newSessionDisabled}
    title="New Session"
    className={`flex items-center gap-2 flex-1 rounded-md text-xs font-medium bg-zinc-900/5 dark:bg-white/10 text-zinc-900 dark:text-white hover:bg-zinc-900/10 dark:hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer ${
      collapsed ? "justify-center p-2" : "px-2.5 py-2"
    }`}
  >
    <PlusIcon className="w-3.5 h-3.5 shrink-0" />
    {!collapsed && "New Session"}
  </button>
  <button
    onClick={onUploadClick}
    disabled={newSessionDisabled}
    title="Upload Recording"
    className={`flex items-center justify-center rounded-md text-xs font-medium bg-zinc-900/5 dark:bg-white/10 text-zinc-900 dark:text-white hover:bg-zinc-900/10 dark:hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer ${
      collapsed ? "p-2" : "px-2.5 py-2"
    }`}
  >
    <DocumentArrowUpIcon className="w-3.5 h-3.5 shrink-0" />
  </button>
</div>
```

Add `DocumentArrowUpIcon` to the `@heroicons/react/20/solid` import at the top of `SessionList.tsx`.

- [ ] **Step 4: Wire state and handlers in `App.tsx`**

Add imports:

```tsx
import { UploadModal } from "./components/UploadModal";
import { SessionProgress } from "./types";
```

Add state (near the other `useState` declarations):

```tsx
const [showUploadModal, setShowUploadModal] = useState(false);
const [uploadProcessing, setUploadProcessing] = useState(false);
const [uploadProgress, setUploadProgress] = useState<SessionProgress | null>(
  null,
);
const [uploadError, setUploadError] = useState("");
```

Add an event listener effect (near the existing `setup-progress` listener effect):

```tsx
useEffect(() => {
  const p = listen<SessionProgress>("session-progress", (e) =>
    setUploadProgress(e.payload),
  );
  return () => {
    p.then((u) => u());
  };
}, []);
```

Add the upload handler (near `handleStart`/`handleStop`):

```tsx
const handleUploadFile = async (path: string) => {
  setUploadError("");
  setUploadProcessing(true);
  setUploadProgress(null);
  try {
    const reportPath = await invoke<string>("start_session_from_file", {
      path,
    });
    setShowUploadModal(false);
    setUploadProcessing(false);
    setShowReport(false);
    setSelectedSession(null);
    setSelectedSessionMarkdown("");
    setUtterances(await invoke<Utterance[]>("get_utterances"));
    setReportPath(reportPath);
    setShowReport(true);
    setSessionRefreshKey((k) => k + 1);
    if (reportPath) {
      setSelectedSession(await invoke<SessionInfo>("get_session_info", {
        path: reportPath,
      }));
    }
  } catch (err) {
    setUploadProcessing(false);
    setUploadError(String(err));
  }
};
```

- [ ] **Step 5: Render the modal and pass the new prop to `SessionList`**

In the JSX, update the `<SessionList ... />` call to add `onUploadClick={() => setShowUploadModal(true)}`:

```tsx
<SessionList
  selectedSession={selectedSession}
  onSelectSession={handleSelectSession}
  onRenameSession={handleRenameSession}
  onDeleteSession={handleDeleteSession}
  onNewSession={handleStart}
  onUploadClick={() => setShowUploadModal(true)}
  newSessionDisabled={newSessionDisabled}
  refreshKey={sessionRefreshKey}
/>
```

Add the modal render, right after the `<SessionList ... />` block:

```tsx
{showUploadModal && (
  <UploadModal
    onClose={() => {
      if (!uploadProcessing) setShowUploadModal(false);
    }}
    onUpload={handleUploadFile}
    processing={uploadProcessing}
    progress={uploadProgress}
    error={uploadError}
  />
)}
```

- [ ] **Step 6: Type-check and build**

Run: `npm run build`
Expected: `tsc && vite build` succeeds with no type errors

- [ ] **Step 7: Manual verification**

Run: `npm run tauri dev`

- Click "Upload Recording" in the sidebar → modal opens.
- Click the drop zone → native file picker opens, filtered to wav/mp3/m4a.
- Pick a short (10-30s) real speech recording in one of the three formats.
- Confirm progress text updates through decoding → transcribing → feedback stages.
- Confirm the report screen appears afterward with utterances, matching the look of a live-session report.
- Confirm the session appears in the sidebar list with the "File" badge, and reopening it shows the same report.
- Confirm a live mic session (New Session → Stop & Save) still works exactly as before (regression check on the `finalize_session` extraction).

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/components/SessionList.tsx
git commit -m "feat: wire file upload flow into App UI (upload button, modal, progress, source badge)"
```

---

## Self-Review Notes

- **Spec coverage:** formats (wav/mp3/m4a via symphonia) → Task 2; Whisper-segment-based splitting → Task 3; drag-and-drop + file-picker modal → Task 7/8; staged progress events → Task 4/5/8; session list distinction → Task 4/8; shared `finalize_session` → Task 4/5; error handling (unsupported format, empty transcript) → Task 2/5; no size/duration cap, no batch upload → not implemented anywhere (correctly — this is "don't build" scope, no task needed).
- **Type consistency:** `SessionSource` (Rust `#[serde(tag = "kind", rename_all = "snake_case")]` enum) matches the TS discriminated union `{ kind: "recorded" }` / `{ kind: "uploaded"; original_filename }` exactly. `SessionProgress` stage strings (`decoding_audio`, `transcribing`, `generating_feedback`) match between the Rust `serde_json::json!` payloads in Task 5 and the TS type in Task 7. `finalize_session`'s signature is identical everywhere it's referenced (Task 4 defines it, Task 5 calls it twice with matching argument order).
- **Placeholder scan:** none found on final pass — the earlier draft's stray `_unused_import_marker` line in Task 2 was removed rather than left as a "delete this" instruction.
