// src/components/FeedbackSidebar.tsx
// 실시간 피드백 패널 - 가장 최신 피드백 표시

import { FeedbackEvent } from "../types";
import "../styles/FeedbackSidebar.css";

interface FeedbackSidebarProps {
  latestFeedback: FeedbackEvent | null;
  isVisible: boolean;
}

export function FeedbackSidebar({
  latestFeedback,
  isVisible,
}: FeedbackSidebarProps) {
  if (!isVisible || !latestFeedback) {
    return <div className="feedback-sidebar empty" />;
  }

  const { feedback, timestamp } = latestFeedback;

  return (
    <div className="feedback-sidebar visible">
      <div className="feedback-header">
        <div className="header-title">💬 Real-Time Feedback</div>
        <div className="header-time">{timestamp}</div>
      </div>

      <div className="feedback-content">
        {/* 원문 */}
        <div className="feedback-section">
          <div className="section-label">You said:</div>
          <div className="section-text original">"{feedback.original}"</div>
        </div>

        {/* 교정 */}
        {feedback.has_error && feedback.corrected && (
          <div className="feedback-section">
            <div className="section-label">🔴 Correction:</div>
            <div className="section-text corrected">"{feedback.corrected}"</div>
          </div>
        )}

        {/* 더 자연스러운 표현 */}
        {feedback.better_expression && (
          <div className="feedback-section">
            <div className="section-label">💡 More Natural:</div>
            <div className="section-text better">
              "{feedback.better_expression}"
            </div>
          </div>
        )}

        {/* 어휘/관용어 */}
        {feedback.idiom_or_vocab && (
          <div className="feedback-section">
            <div className="section-label">📚 Vocabulary:</div>
            <div className="section-text vocab">{feedback.idiom_or_vocab}</div>
          </div>
        )}

        {/* 에러 없을 때 */}
        {!feedback.has_error && (
          <div className="feedback-section success">
            <div className="section-label">✅ Great!</div>
            <div className="section-text">No corrections needed</div>
          </div>
        )}
      </div>
    </div>
  );
}
