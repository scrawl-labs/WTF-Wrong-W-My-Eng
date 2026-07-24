// feedback.rs
// Ollama LLM을 통한 영어 피드백 생성
//
// 핵심 Rust 개념:
// - async/await: 비동기 프로그래밍
// - serde: 직렬화/역직렬화 (Serialize, Deserialize)
// - reqwest: HTTP 클라이언트

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

const OLLAMA_URL: &str = "http://localhost:11434/api/generate";
const OLLAMA_MODEL: &str = "llama3.1:8b";

/// LLM이 반환하는 피드백 구조체
///
/// #[derive(Serialize, Deserialize)]: JSON 변환 자동 구현
/// #[derive(Clone)]: .clone()으로 복사 가능하게
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FeedbackResult {
    /// 내가 한 말 (원문)
    pub original: String,

    /// 문법 교정 (오류 없으면 None)
    pub corrected: Option<String>,

    /// 더 자연스러운 표현 (이미 자연스러우면 None)
    pub better_expression: Option<String>,

    /// 이 문맥에서 배울 만한 관용어/어휘
    pub idiom_or_vocab: Option<String>,

    /// 교정이 필요한 문장인지
    pub has_error: bool,
}

/// LLM에게 보내는 프롬프트
const SYSTEM_PROMPT: &str = r#"You are a concise English language tutor for a Korean learner in an online lesson.
Analyze the student's spoken English sentence and return ONLY a JSON object.

Required JSON fields:
- "has_error": boolean (true if grammar/vocabulary issue exists)
- "corrected": string or null (corrected sentence, null if no error)  
- "better_expression": string or null (more natural phrasing, null if already natural)
- "idiom_or_vocab": string or null (one useful idiom or word from this context, format: "phrase: meaning")

Rules:
- Be concise. No explanations outside JSON.
- Only suggest corrections for clear errors, not stylistic preferences.
- Pick idiom_or_vocab only if genuinely useful for an intermediate learner.

Example output:
{"has_error":true,"corrected":"I went to school yesterday","better_expression":"I headed to school yesterday","idiom_or_vocab":"head to: to go toward a place"}"#;

/// 발화 텍스트에 대한 영어 피드백 요청
///
/// `async fn`: 비동기 함수 - .await로 호출
pub async fn get_feedback(text: &str) -> Result<FeedbackResult> {
    // 너무 짧으면 LLM 호출 스킵
    if text.split_whitespace().count() < 3 {
        return Ok(FeedbackResult {
            original: text.to_string(),
            corrected: None,
            better_expression: None,
            idiom_or_vocab: None,
            has_error: false,
        });
    }

    let client = reqwest::Client::new();

    let prompt = format!("{SYSTEM_PROMPT}\n\nStudent said: \"{text}\"");

    // Ollama API 호출
    // serde_json::json! 매크로: JSON 리터럴 생성
    let response = client
        .post(OLLAMA_URL)
        .json(&serde_json::json!({
            "model": OLLAMA_MODEL,
            "prompt": prompt,
            "stream": false,
            "format": "json",
            "options": {
                "temperature": 0.3,  // 낮을수록 일관된 출력
                "num_predict": 200   // 최대 토큰 수
            }
        }))
        .send()
        .await
        .context("Ollama 서버에 연결할 수 없습니다. `ollama serve`가 실행 중인지 확인하세요.")?;

    // 응답 JSON 파싱
    let body: serde_json::Value = response
        .json()
        .await
        .context("Ollama 응답 파싱 실패")?;

    let response_text = body["response"]
        .as_str()
        .context("Ollama 응답에 'response' 필드가 없습니다")?;

    // LLM이 반환한 JSON 문자열 → FeedbackResult 구조체
    let mut feedback: FeedbackResult = serde_json::from_str(response_text)
        .with_context(|| format!("피드백 JSON 파싱 실패:\n{response_text}"))?;

    // 원문 주입 (LLM 응답에 포함되지 않으므로)
    feedback.original = text.to_string();

    Ok(feedback)
}
