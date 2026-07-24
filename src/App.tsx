import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FeedbackEvent, SetupStatus, Utterance } from "./types";
import { RecordingStatus } from "./components/RecordingStatus";
import { FeedbackSidebar } from "./components/FeedbackSidebar";
import { SessionReport } from "./components/SessionReport";
import "./App.css";

export function App() {
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [sessionStartTime, setSessionStartTime] = useState<Date | null>(null);
  const [latestFeedback, setLatestFeedback] = useState<FeedbackEvent | null>(
    null,
  );
  const [utterances, setUtterances] = useState<Utterance[]>([]);
  const [reportPath, setReportPath] = useState<string>("");
  const [showReport, setShowReport] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // 초기화: 모델 준비 상태 확인
  useEffect(() => {
    const checkSetup = async () => {
      try {
        const status = await invoke<SetupStatus>("check_setup");
        setSetupStatus(status);

        if (!status.model_ready) {
          setErrorMsg(
            `⚠️ Whisper 모델이 준비되지 않았습니다.\n\n${status.download_instructions}`,
          );
        }
      } catch (err) {
        console.error("Setup check failed:", err);
        setErrorMsg(`❌ 백엔드 에러: ${err}`);
      }
    };

    checkSetup();
  }, []);

  // 실시간 피드백 이벤트 수신
  useEffect(() => {
    const unlistenPromise = listen<FeedbackEvent>("feedback", (event) => {
      setLatestFeedback(event.payload);
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  // 녹음 상태 주기적 확인
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const recording = await invoke<boolean>("get_recording_status");
        setIsRecording(recording);

        if (recording) {
          const utts = await invoke<Utterance[]>("get_utterances");
          setUtterances(utts);
        }
      } catch (err) {
        console.error("Status check failed:", err);
      }
    };

    const interval = setInterval(checkStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleStartSession = async () => {
    setErrorMsg("");
    setShowReport(false);
    setLatestFeedback(null);
    setUtterances([]);
    setReportPath("");

    try {
      setSessionStartTime(new Date());
      await invoke("start_session");
      setIsRecording(true);
    } catch (err) {
      setErrorMsg(`❌ 세션 시작 실패:\n${err}`);
      setIsRecording(false);
      setSessionStartTime(null);
    }
  };

  const handleStopSession = async () => {
    try {
      const path = await invoke<string>("stop_session");
      setIsRecording(false);
      setReportPath(path);
      setShowReport(true);

      // 최종 발화 목록 로드
      const utts = await invoke<Utterance[]>("get_utterances");
      setUtterances(utts);
    } catch (err) {
      setErrorMsg(`❌ 세션 종료 실패:\n${err}`);
    }
  };

  const isModelReady = setupStatus?.model_ready ?? false;

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <h1>🎙️ WTF Wrong W/ My Eng</h1>
          <p className="subtitle">
            Real-time English feedback during your lesson
          </p>
        </div>
        <div className="header-status">
          {isModelReady ? (
            <span className="status-badge ready">✅ Ready</span>
          ) : (
            <span className="status-badge warning">⚠️ Setup Required</span>
          )}
        </div>
      </header>

      <main className="app-main">
        <div className="main-container">
          {/* 에러 메시지 */}
          {errorMsg && (
            <div className="error-box">
              <button className="error-close" onClick={() => setErrorMsg("")}>
                ✕
              </button>
              <pre>{errorMsg}</pre>
            </div>
          )}

          {/* 조절판 */}
          <div className="control-panel">
            <RecordingStatus
              isRecording={isRecording}
              sessionStartTime={sessionStartTime}
            />

            <div className="button-group">
              <button
                className="btn btn-primary"
                onClick={handleStartSession}
                disabled={isRecording || !isModelReady}
              >
                {isRecording ? "🔴 Recording..." : "🎤 Start Session"}
              </button>

              <button
                className="btn btn-secondary"
                onClick={handleStopSession}
                disabled={!isRecording}
              >
                ⏹️ Stop & Save
              </button>
            </div>
          </div>

          {/* 사이드바 */}
          <FeedbackSidebar
            latestFeedback={latestFeedback}
            isVisible={isRecording}
          />

          {/* 세션 리포트 */}
          <SessionReport
            utterances={utterances}
            reportPath={reportPath}
            isVisible={showReport}
          />
        </div>
      </main>

      <footer className="app-footer">
        <p>
          💡 Tip: Keep Ollama running (<code>ollama serve</code>) in another
          terminal
        </p>
      </footer>
    </div>
  );
}

export default App;
