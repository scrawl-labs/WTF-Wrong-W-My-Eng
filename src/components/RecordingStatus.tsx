import { useEffect, useState } from "react";

interface RecordingStatusProps {
  isRecording: boolean;
  sessionStartTime: Date | null;
}

export function RecordingStatus({ isRecording, sessionStartTime }: RecordingStatusProps) {
  const [elapsed, setElapsed] = useState("00:00:00");

  useEffect(() => {
    if (!isRecording || !sessionStartTime) return;
    const interval = setInterval(() => {
      const diff = Math.floor((Date.now() - sessionStartTime.getTime()) / 1000);
      const h = String(Math.floor(diff / 3600)).padStart(2, "0");
      const m = String(Math.floor((diff % 3600) / 60)).padStart(2, "0");
      const s = String(diff % 60).padStart(2, "0");
      setElapsed(`${h}:${m}:${s}`);
    }, 1000);
    return () => clearInterval(interval);
  }, [isRecording, sessionStartTime]);

  return (
    <div className="flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full shrink-0 ${isRecording ? "bg-red-500 animate-pulse" : "bg-gray-300 dark:bg-gray-600"}`} />
      <span className={`text-xs font-medium ${isRecording ? "text-red-500" : "text-gray-400 dark:text-gray-500"}`}>
        {isRecording ? "Recording" : "Idle"}
      </span>
      {isRecording && (
        <span className="font-mono text-xs font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950 px-2 py-0.5 rounded tabular-nums">
          {elapsed}
        </span>
      )}
    </div>
  );
}
