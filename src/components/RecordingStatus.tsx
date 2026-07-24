// src/components/RecordingStatus.tsx
// 녹음 상태 표시 + 타이머

import { useEffect, useState } from "react";
import "../styles/RecordingStatus.css";

interface RecordingStatusProps {
  isRecording: boolean;
  sessionStartTime: Date | null;
}

export function RecordingStatus({
  isRecording,
  sessionStartTime,
}: RecordingStatusProps) {
  const [elapsed, setElapsed] = useState("00:00:00");

  useEffect(() => {
    if (!isRecording || !sessionStartTime) return;

    const interval = setInterval(() => {
      const now = new Date();
      const diff = Math.floor(
        (now.getTime() - sessionStartTime.getTime()) / 1000,
      );

      const hours = String(Math.floor(diff / 3600)).padStart(2, "0");
      const minutes = String(Math.floor((diff % 3600) / 60)).padStart(2, "0");
      const seconds = String(diff % 60).padStart(2, "0");

      setElapsed(`${hours}:${minutes}:${seconds}`);
    }, 1000);

    return () => clearInterval(interval);
  }, [isRecording, sessionStartTime]);

  return (
    <div className="recording-status">
      <div className="status-indicator">
        <span className={`dot ${isRecording ? "recording" : "idle"}`} />
        <span className="label">
          {isRecording ? "🎙️ Recording" : "⏸️ Idle"}
        </span>
      </div>
      {isRecording && <div className="timer">{elapsed}</div>}
    </div>
  );
}
