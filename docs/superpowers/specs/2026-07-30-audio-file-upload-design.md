# 녹음 파일 업로드 리포트 기능 설계

## 배경 / 목표

현재 앱은 마이크로 실시간 녹음한 세션만 지원한다. 요구사항에 사용자가 이미 가지고 있는
녹음 파일(m4a, mp3, wav 등)을 업로드해서 동일한 형식의 리포트를 받을 수 있어야 한다는
항목이 추가됐다. 이 문서는 그 기능의 설계를 다룬다.

핵심 원칙: 라이브 녹음 세션과 업로드 세션이 **리포트 생성 로직을 완전히 공유**하도록
만든다. 차이는 오직 "발화 목록(RawUtterance[])을 어떻게 얻는가"뿐이다.

- 라이브 녹음: 마이크 → RMS 기반 VAD로 발화 단위 분리 → Whisper 전사 (텍스트만)
- 업로드: 파일 디코딩 → Whisper 자체 세그먼트 타임스탬프로 발화 단위 분리 → Whisper 전사 (텍스트 + 타임스탬프)

두 경로 모두 동일한 `finalize_session()`(LLM 피드백 일괄 생성 + 저장)으로 합류한다.

## 아키텍처

```
[프론트: 업로드 모달] --path--> start_session_from_file(path)
                                        │
                                  decode.rs (symphonia)
                                  → 원본 PCM (native rate/ch)
                                        │
                                  dsp.rs (audio.rs에서 추출)
                                  → mono + 16kHz 리샘플
                                        │
                                  transcribe.rs::transcribe_with_segments()
                                  → whisper 자체 세그먼트 타임스탬프로 발화 분리
                                  → progress callback으로 "전사 중 N%" emit
                                        │
                                  session::finalize_session()  ← stop_session과 공유
                                  → 발화별 LLM 피드백 생성 (진행률 emit)
                                  → .md/.json/.txt 저장 + .source 사이드카 기록
                                        │
                                  리포트 경로 반환 → 프론트가 기존 SessionReport 화면 표시
```

## 지원 포맷

symphonia(순수 Rust 오디오 디코딩 라이브러리, 외부 바이너리 의존성 없음)를 사용해
wav, mp3, m4a(AAC/isomp4 컨테이너)를 지원한다.

```toml
symphonia = { version = "0.5", features = ["mp3", "aac", "isomp4", "wav"] }
```

## 백엔드 변경사항

### `src-tauri/src/dsp.rs` (신규)

`audio.rs`에 있던 `to_mono`, `resample` 순수 함수를 이 모듈로 옮기고 `pub(crate)`로
공개한다. `audio.rs`(마이크 캡처)와 `decode.rs`(파일 디코딩) 둘 다 이 모듈을 사용한다.

### `src-tauri/src/decode.rs` (신규)

```rust
pub fn decode_file_to_pcm16k(path: &Path) -> Result<Vec<f32>>
```

symphonia로 컨테이너/코덱을 probe하고 디코딩해 원본 샘플레이트/채널의 f32 PCM을 얻은
뒤, `dsp::to_mono` + `dsp::resample`로 16kHz 모노로 변환해 반환한다.

### `src-tauri/src/transcribe.rs`

기존 `transcribe()`(텍스트만 반환, 라이브 VAD 청크용)는 그대로 둔다.

신규 함수:

```rust
pub fn transcribe_with_segments(
    audio: &[f32],
    on_progress: impl FnMut(f32) + Send + 'static,
) -> Result<Vec<TranscribedSegment>>

pub struct TranscribedSegment {
    pub text: String,
    pub start_secs: f32,
    pub end_secs: f32,
}
```

whisper_rs의 `full_get_segment_t0`/`full_get_segment_t1`로 세그먼트별 타임스탬프를
얻고, `set_progress_callback_safe`로 전사 진행률을 콜백으로 흘려보낸다.

### `src-tauri/src/session.rs`

- `SessionSource` enum 추가:
  ```rust
  pub enum SessionSource {
      Recorded,
      Uploaded { original_filename: String },
  }
  ```
  `.source` 사이드카 파일(`<base>.source`, 예: `uploaded|녹음본.m4a` 한 줄)로 저장한다.
  기존 `.title`/`.txt` 사이드카와 동일한 패턴. JSON 리포트 스키마는 건드리지 않아 과거
  세션과의 호환성을 유지한다.

- `stop_session`에 있던 "전문 저장 → 발화별 LLM 피드백 루프(진행률 emit) → 리포트
  저장" 블록을 `finalize_session(raw_utterances, start_time, source, app) -> Result<String>`
  으로 추출한다. `stop_session`과 신규 업로드 커맨드가 모두 이 함수를 호출해 리포트
  생성 로직이 완전히 하나로 유지되도록 한다.

- `SessionInfo`에 `source` 필드를 추가하고 `list_sessions`/`get_session_info`가
  `.source` 사이드카를 읽어 채운다. 사이드카가 없는 과거 세션은 `Recorded`로 취급한다.

### `src-tauri/src/commands.rs`

신규 커맨드:

```rust
#[tauri::command]
pub async fn start_session_from_file(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<String, String>
```

흐름: Whisper 모델 준비 확인 → `decode::decode_file_to_pcm16k`(progress:
`decoding_audio`) → `transcribe::transcribe_with_segments`(progress:
`transcribing`, N%) → 세그먼트를 `RawUtterance`로 변환(타임스탬프는 파일 시작 기준
경과 mm:ss) → `session::finalize_session(..., SessionSource::Uploaded)`(progress:
`generating_feedback`, N/M) → 리포트 경로 반환.

라이브 세션과 달리 별도의 "시작/종료" 단계가 없다 — 파일 하나 = 한 번의 처리 =
완료 시 리포트 경로 즉시 반환.

**타임스탬프 의미 차이**: 라이브 세션의 `RawUtterance.timestamp`는 발화가 있었던
벽시계 시각(HH:MM:SS)이다. 업로드 세션에서는 이 필드에 파일 시작 기준 경과 시간
(mm:ss)을 넣는다. 필드 타입은 동일(String)하고 표시 용도로만 쓰이므로 스키마 변경은
필요 없다.

## 프론트엔드 변경사항

- `src/components/UploadModal.tsx` (신규): 드래그앤드롭 영역 + `@tauri-apps/plugin-dialog`의
  `open()`을 이용한 파일 선택 버튼(폴백). 지원 확장자로 필터링.
- idle 화면의 "세션 시작" 버튼 옆에 "파일 업로드" 버튼을 추가해 모달을 연다.
- 파일 선택 후 `invoke("start_session_from_file", { path })` 호출, `upload-progress`
  이벤트를 구독해 기존 `setup-progress` 처리 패턴과 동일하게 단계별 진행률(디코딩 →
  전사 N% → 피드백 N/M)을 보여준다.
- 완료 후 기존 `SessionReport` 컴포넌트를 그대로 재사용한다(데이터 구조가 동일하므로
  추가 구현 불필요).
- 세션 목록/리포트 헤더에 업로드 세션이면 작은 배지(아이콘)를 표시한다. `SessionInfo`에
  추가된 `source` 필드로 분기.

## 에러 처리

- 지원하지 않는 포맷/손상된 파일: `decode.rs`에서 명확한 에러 메시지로 실패시키고
  프론트에 그대로 노출한다.
- 세그먼트가 0개(무음만 있거나 인식된 발화 없음): "인식된 발화가 없습니다" 에러 처리,
  세션 저장하지 않는다.
- 파일 길이 제한은 두지 않는다(로컬 처리라 서버 비용 문제가 없음). 대신 단계별
  진행률로 사용자가 오래 걸리는 것을 체감할 수 있게 한다.

## 테스트

- Rust 유닛 테스트: `dsp::resample`/`dsp::to_mono` 순수 함수(입출력 검증),
  `decode_file_to_pcm16k`는 작은 wav/mp3 테스트 픽스처로 디코딩 결과(샘플 수,
  범위)를 검증한다.
- `finalize_session` 추출 후 기존 라이브 녹음 흐름이 그대로 동작하는지 회귀 확인
  (로컬 빌드 + 수동 실행으로 라이브 세션 리포트 생성 확인).
- 업로드 흐름은 짧은 테스트 음성 파일로 수동 E2E 확인(파일 선택 → 리포트 생성까지).

## 범위에서 제외한 것

- 세그먼트 단위 실시간(청크별) 전사 미리보기 — whisper의 세그먼트 콜백을 활용하면
  가능하지만, 첫 구현에서는 단계별 진행률 표시로 충분하다고 판단해 제외.
- 업로드 파일 길이/용량 제한, 서버 업로드(모두 로컬 처리).
- 여러 파일 동시 업로드(배치 처리) — 한 번에 하나의 파일만 지원.
