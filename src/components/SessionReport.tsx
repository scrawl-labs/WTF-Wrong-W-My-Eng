// src/components/SessionReport.tsx
// 세션 끝난 후 전체 리포트 표시

import { Utterance } from "../types";
import "../styles/SessionReport.css";

interface SessionReportProps {
  utterances: Utterance[];
  reportPath?: string;
  isVisible: boolean;
}

export function SessionReport({
  utterances,
  reportPath,
  isVisible,
}: SessionReportProps) {
  if (!isVisible || utterances.length === 0) {
    return <div className="session-report empty" />;
  }

  const errorCount = utterances.filter((u) => u.feedback.has_error).length;
  const vocabItems = utterances
    .filter((u) => u.feedback.idiom_or_vocab)
    .map((u) => u.feedback.idiom_or_vocab);

  const uniqueVocab = [...new Set(vocabItems)];

  return (
    <div className="session-report visible">
      <div className="report-header">
        <h2>📊 Session Report</h2>
        {reportPath && (
          <div className="report-path">
            Saved to: <code>{reportPath}</code>
          </div>
        )}
      </div>

      <div className="report-summary">
        <div className="summary-item">
          <div className="summary-label">Total Utterances</div>
          <div className="summary-value">{utterances.length}</div>
        </div>
        <div className="summary-item">
          <div className="summary-label">Corrections Needed</div>
          <div className="summary-value error">{errorCount}</div>
        </div>
        <div className="summary-item">
          <div className="summary-label">New Vocabulary</div>
          <div className="summary-value">{uniqueVocab.length}</div>
        </div>
      </div>

      {/* 어휘 섹션 */}
      {uniqueVocab.length > 0 && (
        <div className="report-section">
          <h3>📚 Vocabulary You Learned</h3>
          <ul className="vocab-list">
            {uniqueVocab.map((vocab, idx) => (
              <li key={idx}>{vocab}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 교정 목록 */}
      {errorCount > 0 && (
        <div className="report-section">
          <h3>🔴 Corrections</h3>
          <div className="corrections-list">
            {utterances
              .filter((u) => u.feedback.has_error)
              .map((u, idx) => (
                <div key={idx} className="correction-item">
                  <div className="timestamp">{u.timestamp}</div>
                  <div className="original">You: "{u.feedback.original}"</div>
                  {u.feedback.corrected && (
                    <div className="corrected">✓ "{u.feedback.corrected}"</div>
                  )}
                  {u.feedback.better_expression && (
                    <div className="better">
                      💡 "{u.feedback.better_expression}"
                    </div>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* 전체 기록 */}
      <div className="report-section">
        <h3>📝 Full Transcript</h3>
        <div className="transcript-list">
          {utterances.map((u, idx) => (
            <div key={idx} className="transcript-item">
              <span className="time">[{u.timestamp}]</span>
              <span className="text">{u.feedback.original}</span>
              {u.feedback.has_error && (
                <span className="badge error">Error</span>
              )}
              {u.feedback.idiom_or_vocab && (
                <span className="badge vocab">Vocab</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
