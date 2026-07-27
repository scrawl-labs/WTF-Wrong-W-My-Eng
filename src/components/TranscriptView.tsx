interface TranscriptViewProps {
  text: string;
}

export function TranscriptView({ text }: TranscriptViewProps) {
  if (!text.trim()) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 select-none">
        <p className="text-xs text-zinc-400 dark:text-zinc-600 text-center leading-relaxed">
          Nothing transcribed yet.
        </p>
      </div>
    );
  }

  return (
    <pre className="text-xs text-zinc-600 dark:text-zinc-400 font-mono leading-relaxed whitespace-pre-wrap break-words">
      {text}
    </pre>
  );
}
