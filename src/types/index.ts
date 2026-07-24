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

export interface FeedbackEvent {
  feedback: FeedbackResult;
  timestamp: string;
}

export interface SetupStatus {
  model_ready: boolean;
  model_path: string;
  download_instructions: string;
}
