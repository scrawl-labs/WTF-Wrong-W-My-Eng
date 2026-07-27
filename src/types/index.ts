// src/types/index.ts
// React와 Rust 백엔드 사이의 공유 타입 정의

export interface FeedbackResult {
  original: string;
  corrected: string | null;
  better_expression: string | null;
  idiom_or_vocab: string | null;
  has_error: boolean;
}

export interface Utterance {
  timestamp: string;
  feedback: FeedbackResult;
}

// 녹음 중 LLM 호출 없이 누적되는 원문 발화 (전문 보기 버튼용)
export interface RawUtterance {
  timestamp: string;
  text: string;
}

// 전체 세션 합산 통계 - idle 화면 대시보드용
export interface Stats {
  total_sessions: number;
  total_utterances: number;
  total_corrections: number;
}

// 첫 실행 설치(Whisper 모델 + Ollama 런타임/서버 + LLM 모델) 진행 상태
// "setup-progress" 이벤트 페이로드
export interface SetupProgress {
  stage:
    | "downloading_whisper_model"
    | "downloading_ollama_runtime"
    | "extracting"
    | "starting_server"
    | "downloading_llm_model"
    | "ready";
  message: string;
  // 0.0~100.0, 알 수 없으면 -1 (인디터미닛 표시)
  percent: number;
}
