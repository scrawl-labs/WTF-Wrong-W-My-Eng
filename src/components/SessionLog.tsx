// src/components/SessionLog.tsx
// 사이드바용 발화 로그 — 타임스탬프 + 원문 + good/bad 배지만 보여주는
// 좁은 폭(w-80) 리스트. 상세 교정/어휘 내용은 SessionReport(main)로 이동했음.

import { Utterance } from "../types";

interface SessionLogProps {
  utterances: Utterance[];
}

export function SessionLog({ utterances }: SessionLogProps) {
  if (utterances.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 select-none">
        <p className="text-xs text-zinc-400 dark:text-zinc-600 text-center leading-relaxed">
          No structured log available for this session.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {utterances.map((u, idx) => (
        <div
          key={idx}
          className="py-2.5 border-b border-zinc-50 dark:border-zinc-800/50 last:border-0"
        >
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500 tabular-nums">
              {u.timestamp}
            </span>
            {u.feedback.has_error ? (
              <span className="inline-flex shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400">
                Needs correction
              </span>
            ) : (
              <span className="inline-flex shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400">
                Good
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-700 dark:text-zinc-300 break-words">
            {u.feedback.original}
          </p>
        </div>
      ))}
    </div>
  );
}
