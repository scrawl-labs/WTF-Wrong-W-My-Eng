import { FeedbackEvent } from "../types";
import { MicrophoneIcon } from "@heroicons/react/24/outline";
import { CheckIcon } from "@heroicons/react/20/solid";

interface FeedbackSidebarProps {
  latestFeedback: FeedbackEvent | null;
  isVisible: boolean;
}

export function FeedbackSidebar({ latestFeedback, isVisible }: FeedbackSidebarProps) {
  if (!isVisible) return null;

  if (!latestFeedback) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-3 select-none">
        <MicrophoneIcon className="w-7 h-7 text-zinc-300 dark:text-zinc-600" />
        <p className="text-xs text-zinc-400 dark:text-zinc-500">Listening...</p>
      </div>
    );
  }

  const { feedback, timestamp } = latestFeedback;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between pb-2 border-b border-zinc-100 dark:border-zinc-800">
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Latest</span>
        <span className="text-xs text-zinc-400 dark:text-zinc-500 font-mono tabular-nums">{timestamp}</span>
      </div>

      {/* 원문 */}
      <div className="pt-1">
        <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-1">You said</p>
        <p className="text-sm text-zinc-800 dark:text-zinc-200">"{feedback.original}"</p>
      </div>

      {/* 결과 */}
      {!feedback.has_error ? (
        <div className="flex items-center gap-2 pt-1">
          <span className="flex items-center justify-center w-4 h-4 rounded-full bg-emerald-100 dark:bg-emerald-900 shrink-0">
            <CheckIcon className="w-2.5 h-2.5 text-emerald-600 dark:text-emerald-400" />
          </span>
          <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">No corrections needed</span>
        </div>
      ) : (
        <div className="space-y-2 pt-1">
          {feedback.corrected && (
            <div>
              <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-0.5">Correction</p>
              <p className="text-sm text-red-600 dark:text-red-400">"{feedback.corrected}"</p>
            </div>
          )}
          {feedback.better_expression && (
            <div>
              <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-0.5">More natural</p>
              <p className="text-sm text-zinc-700 dark:text-zinc-300">"{feedback.better_expression}"</p>
            </div>
          )}
        </div>
      )}

      {feedback.idiom_or_vocab && (
        <div className="pt-1 border-t border-zinc-100 dark:border-zinc-800 mt-2">
          <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-0.5">Vocabulary</p>
          <p className="text-sm text-zinc-700 dark:text-zinc-300">{feedback.idiom_or_vocab}</p>
        </div>
      )}
    </div>
  );
}
