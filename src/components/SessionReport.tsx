import { Utterance } from "../types";

interface SessionReportProps {
  utterances: Utterance[];
  reportPath?: string;
  isVisible: boolean;
  markdownContent?: string;
}

export function SessionReport({
  utterances,
  reportPath,
  isVisible,
  markdownContent,
}: SessionReportProps) {
  if (!isVisible) return null;

  // 구조화된 발화 기록(JSON)이 있으면 항상 이걸 우선 사용 — 라이브 리포트와 동일한 카드 UI.
  // markdownContent는 JSON 사이드카가 없는 옛날 세션에 대한 폴백일 때만 사용.
  if (utterances.length === 0 && markdownContent) {
    return (
      <pre className="text-xs text-zinc-500 dark:text-zinc-400 font-mono leading-relaxed whitespace-pre-wrap">
        {markdownContent}
      </pre>
    );
  }

  if (utterances.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 select-none">
        <p className="text-xs text-zinc-400 dark:text-zinc-600 text-center leading-relaxed">
          No speech was captured in this session.
        </p>
      </div>
    );
  }

  const errorCount = utterances.filter((u) => u.feedback.has_error).length;
  const vocabItems = [
    ...new Set(
      utterances
        .filter((u) => u.feedback.idiom_or_vocab)
        .map((u) => u.feedback.idiom_or_vocab),
    ),
  ];

  return (
    <div className="space-y-6">
      {/* 요약 통계 */}
      <div>
        <h3 className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-3">
          Overview
        </h3>
        <div className="grid grid-cols-3 gap-3">
          {[
            {
              label: "Utterances",
              value: utterances.length,
              color: "text-zinc-800 dark:text-zinc-100",
            },
            {
              label: "Corrections",
              value: errorCount,
              color: "text-red-600 dark:text-red-400",
            },
            {
              label: "Vocab",
              value: vocabItems.length,
              color: "text-zinc-800 dark:text-zinc-100",
            },
          ].map(({ label, value, color }) => (
            <div
              key={label}
              className="min-w-0 border border-zinc-100 dark:border-zinc-800 rounded-lg p-2.5"
            >
              <div className={`text-xl font-semibold tabular-nums ${color}`}>
                {value}
              </div>
              <div className="text-[11px] leading-tight text-zinc-400 dark:text-zinc-500 mt-0.5">
                {label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 어휘 */}
      {vocabItems.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
            New Vocabulary
          </h3>
          <div className="space-y-1">
            {vocabItems.map((vocab, idx) => (
              <div
                key={idx}
                className="text-sm text-zinc-700 dark:text-zinc-300 py-1.5 border-b border-zinc-50 dark:border-zinc-800/50 last:border-0 break-words"
              >
                {vocab}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 교정 목록 */}
      {errorCount > 0 && (
        <div>
          <h3 className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
            Corrections
          </h3>
          <div className="space-y-3">
            {utterances
              .filter((u) => u.feedback.has_error)
              .map((u, idx) => (
                <div
                  key={idx}
                  className="border-l-2 border-red-200 dark:border-red-800 pl-3"
                >
                  <div className="text-xs text-zinc-400 dark:text-zinc-500 font-mono tabular-nums mb-1">
                    {u.timestamp}
                  </div>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-1 break-words">
                    "{u.feedback.original}"
                  </p>
                  {u.feedback.corrected && (
                    <p className="text-sm text-zinc-800 dark:text-zinc-200 font-medium break-words">
                      "{u.feedback.corrected}"
                    </p>
                  )}
                  {u.feedback.better_expression && (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 break-words">
                      {u.feedback.better_expression}
                    </p>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      {reportPath && (
        <p className="text-xs text-zinc-400 dark:text-zinc-600 font-mono truncate pt-2 border-t border-zinc-100 dark:border-zinc-800">
          {reportPath}
        </p>
      )}
    </div>
  );
}
