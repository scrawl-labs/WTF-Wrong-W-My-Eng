// session.rs
// 세션 관리 및 마크다운 리포트 저장
//
// 핵심 Rust 개념:
// - struct와 impl: 타입 정의와 메서드
// - String formatting: format! 매크로
// - std::fs: 파일시스템 작업

use crate::feedback::FeedbackResult;
use anyhow::Result;
use chrono::{DateTime, Local};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// 한 번의 발화와 그에 대한 피드백
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Utterance {
    /// HH:MM:SS 형식 타임스탬프
    pub timestamp: String,
    pub feedback: FeedbackResult,
}

/// 세션 리포트 저장 디렉터리
/// ~/.wtf-english/sessions/
pub fn get_sessions_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".wtf-english")
        .join("sessions")
}

/// 세션 리포트를 마크다운 파일로 저장
///
/// # 반환값
/// 저장된 파일의 절대 경로
pub fn save_report(utterances: &[Utterance], start_time: &DateTime<Local>) -> Result<PathBuf> {
    let dir = get_sessions_dir();
    // create_dir_all: 중간 디렉터리도 모두 생성 (mkdir -p)
    std::fs::create_dir_all(&dir)?;

    let filename = format!("{}.md", start_time.format("%Y-%m-%d_%H-%M-%S"));
    let path = dir.join(&filename);

    let content = build_markdown(utterances, start_time);
    std::fs::write(&path, content)?;

    println!("[Session] 리포트 저장: {:?}", path);
    Ok(path)
}

/// 마크다운 리포트 생성
fn build_markdown(utterances: &[Utterance], start_time: &DateTime<Local>) -> String {
    let total = utterances.len();
    let error_count = utterances.iter().filter(|u| u.feedback.has_error).count();
    let vocab_items: Vec<_> = utterances
        .iter()
        .filter_map(|u| u.feedback.idiom_or_vocab.as_ref())
        .collect();

    // 여러 줄의 문자열을 조합할 때 String::new() + push_str 패턴
    let mut md = String::new();

    md.push_str(&format!(
        "# 🎙️ English Session — {}\n\n",
        start_time.format("%Y년 %m월 %d일 %H:%M")
    ));

    // 요약 섹션
    md.push_str("## 📊 요약\n\n");
    md.push_str(&format!("- 총 발화: **{total}**문장\n"));
    md.push_str(&format!("- 교정 필요: **{error_count}**문장\n"));
    md.push_str(&format!(
        "- 새로운 표현/어휘: **{}**개\n\n",
        vocab_items.len()
    ));

    // 교정 목록
    let errors: Vec<_> = utterances.iter().filter(|u| u.feedback.has_error).collect();
    if !errors.is_empty() {
        md.push_str("## 🔴 교정 목록\n\n");
        md.push_str("| 내가 한 말 | 교정 | 더 자연스럽게 |\n");
        md.push_str("|:----------|:-----|:--------------|\n");
        for u in &errors {
            let corrected = u.feedback.corrected.as_deref().unwrap_or("—");
            let better = u.feedback.better_expression.as_deref().unwrap_or("—");
            md.push_str(&format!(
                "| {} | {} | {} |\n",
                u.feedback.original, corrected, better
            ));
        }
        md.push('\n');
    }

    // 어휘/관용어 섹션
    if !vocab_items.is_empty() {
        md.push_str("## 📚 오늘 배운 표현\n\n");
        for item in vocab_items {
            md.push_str(&format!("- **{}**\n", item));
        }
        md.push('\n');
    }

    // 전체 발화 기록
    if !utterances.is_empty() {
        md.push_str("## 📝 전체 발화 기록\n\n");
        for u in utterances {
            md.push_str(&format!("**[{}]** {}\n", u.timestamp, u.feedback.original));
            if let Some(ref c) = u.feedback.corrected {
                md.push_str(&format!("→ 교정: _{c}_\n"));
            }
            if let Some(ref b) = u.feedback.better_expression {
                md.push_str(&format!("→ 더 자연스럽게: _{b}_\n"));
            }
            md.push('\n');
        }
    }

    md
}

/// 저장된 모든 세션 목록 반환
/// 최신순으로 정렬
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SessionInfo {
    pub filename: String,  // "2025-01-20_14-30-45.md"
    pub title: String,     // "Jan 20, 2:30 PM"
    pub path: String,      // 절대 경로
}

pub fn list_sessions() -> Result<Vec<SessionInfo>> {
    let dir = get_sessions_dir();
    
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut sessions = Vec::new();

    for entry in std::fs::read_dir(&dir)? {
        let entry = entry?;
        let path = entry.path();
        
        if path.extension().map_or(false, |ext| ext == "md") {
            if let Some(filename) = path.file_name().and_then(|f| f.to_str()) {
                // 파일명에서 타임스탬프 파싱: "2025-01-20_14-30-45.md" → "Jan 20, 2:30 PM"
                let title = format_session_title(filename);
                
                sessions.push(SessionInfo {
                    filename: filename.to_string(),
                    title,
                    path: path.to_string_lossy().to_string(),
                });
            }
        }
    }

    // 최신순 정렬 (역순)
    sessions.sort_by(|a, b| b.filename.cmp(&a.filename));
    
    Ok(sessions)
}

fn format_session_title(filename: &str) -> String {
    // "2025-01-20_14-30-45.md" → "Jan 20, 2:30 PM"
    filename
        .strip_suffix(".md")
        .and_then(|s| {
            let parts: Vec<&str> = s.split('_').collect();
            if parts.len() == 2 {
                let date = parts[0];
                let time = parts[1];
                
                let date_parts: Vec<&str> = date.split('-').collect();
                let time_parts: Vec<&str> = time.split('-').collect();
                
                if date_parts.len() == 3 && time_parts.len() == 3 {
                    let month = date_parts[1];
                    let day = date_parts[2];
                    let hour = time_parts[0];
                    let min = time_parts[1];
                    
                    let months = [
                        "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
                    ];
                    
                    if let (Ok(m), Ok(d), Ok(h), Ok(min_num)) =
                        (month.parse::<usize>(), day.parse::<u32>(), hour.parse::<u32>(), min.parse::<u32>())
                    {
                        if m > 0 && m <= 12 {
                            let am_pm = if h < 12 { "AM" } else { "PM" };
                            let h12 = if h % 12 == 0 { 12 } else { h % 12 };
                            return Some(format!(
                                "{} {}, {}:{:02} {}",
                                months[m], d, h12, min_num, am_pm
                            ));
                        }
                    }
                }
            }
            None
        })
        .unwrap_or_else(|| filename.to_string())
}
