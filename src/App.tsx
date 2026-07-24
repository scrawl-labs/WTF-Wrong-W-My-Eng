import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FeedbackEvent, SetupStatus, Utterance } from "./types";
import { RecordingStatus } from "./components/RecordingStatus";
import { FeedbackSidebar } from "./components/FeedbackSidebar";
import { SessionReport } from "./components/SessionReport";
import { SessionList, SessionInfo } from "./components/SessionList";
import {
  SunIcon,
  MoonIcon,
  StopIcon,
  MicrophoneIcon,
  XMarkIcon,
} from "@heroicons/react/20/solid";
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
  const [selectedSession, setSelectedSession] = useState<SessionInfo | null>(
    null,
  );
  const [selectedSessionMarkdown, setSelectedSessionMarkdown] =
    useState<string>("");
  const [sessionRefreshKey, setSessionRefreshKey] = useState(0);
  const [isDark, setIsDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  useEffect(() => {
    invoke<SetupStatus>("check_setup")
      .then((status) => {
        setSetupStatus(status);
        if (!status.model_ready) setErrorMsg(status.download_instructions);
      })
      .catch((err) => setErrorMsg(String(err)));
  }, []);

  useEffect(() => {
    const p = listen<FeedbackEvent>("feedback", (e) =>
      setLatestFeedback(e.payload),
    );
    return () => {
      p.then((u) => u());
    };
  }, []);

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const recording = await invoke<boolean>("get_recording_status");
        setIsRecording(recording);
        if (recording)
          setUtterances(await invoke<Utterance[]>("get_utterances"));
      } catch {}
    }, 2000);
    return () => clearInterval(id);
  }, []);

  const handleStart = async () => {
    setErrorMsg("");
    setShowReport(false);
    setSelectedSession(null);
    setSelectedSessionMarkdown("");
    setLatestFeedback(null);
    setUtterances([]);
    setReportPath("");
    try {
      setSessionStartTime(new Date());
      await invoke("start_session");
      setIsRecording(true);
    } catch (err) {
      setErrorMsg(String(err));
      setIsRecording(false);
      setSessionStartTime(null);
    }
  };

  const handleStop = async () => {
    try {
      const path = await invoke<string>("stop_session");
      setIsRecording(false);
      setReportPath(path);
      setShowReport(true);
      setUtterances(await invoke<Utterance[]>("get_utterances"));
      setSessionRefreshKey((k) => k + 1);
    } catch (err) {
      setErrorMsg(String(err));
    }
  };

  const handleSelectSession = async (session: SessionInfo) => {
    setSelectedSession(session);
    setShowReport(false);
    setUtterances([]);
    setSelectedSessionMarkdown("");
    try {
      const content = await invoke<string>("read_session", {
        path: session.path,
      });
      setSelectedSessionMarkdown(content);
      setShowReport(true);
    } catch (err) {
      setErrorMsg(String(err));
    }
  };

  const isModelReady = setupStatus?.model_ready ?? false;
  const rightPanelTitle = isRecording
    ? "Live Feedback"
    : showReport
      ? (selectedSession?.title ?? "Report")
      : "Details";

  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-zinc-900 font-sans antialiased">
      {/* ── 다크 사이드바 ────────────────── */}
      <SessionList
        selectedSession={selectedSession}
        onSelectSession={handleSelectSession}
        refreshKey={sessionRefreshKey}
      />

      {/* ── 메인 영역 ──────────────────────── */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* 상단 툴바 */}
        <header className="flex items-center justify-between h-16 px-6 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shrink-0">
          <div>
            <h1 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {isRecording
                ? "Session in progress"
                : selectedSession
                  ? selectedSession.title
                  : "Ready"}
            </h1>
            <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">
              {isRecording
                ? "Speak naturally — feedback appears on the right"
                : "Select a session or start recording"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <RecordingStatus
              isRecording={isRecording}
              sessionStartTime={sessionStartTime}
            />
            <div className="flex items-center gap-1.5">
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  isModelReady ? "bg-emerald-500" : "bg-amber-500"
                }`}
              />
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {isModelReady ? "Model ready" : "Setup required"}
              </span>
            </div>
            <button
              onClick={() => setIsDark((d) => !d)}
              className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              {isDark ? (
                <SunIcon className="w-4 h-4" />
              ) : (
                <MoonIcon className="w-4 h-4" />
              )}
            </button>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          {/* 중앙 컨텐츠 */}
          <main className="flex flex-col flex-1 overflow-y-auto px-6 py-6 bg-zinc-50 dark:bg-zinc-950">
            {/* 에러 배너 */}
            {errorMsg && (
              <div className="flex items-start gap-3 mb-5 p-3.5 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/50 rounded-lg">
                <p className="text-xs text-red-700 dark:text-red-400 flex-1 whitespace-pre-wrap font-sans">
                  {errorMsg}
                </p>
                <button
                  onClick={() => setErrorMsg("")}
                  className="text-red-400 hover:text-red-600 dark:hover:text-red-300 shrink-0"
                >
                  <XMarkIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* 메인 카드 */}
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl">
              <div className="px-6 py-5 border-b border-zinc-100 dark:border-zinc-800">
                <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  Recording
                </h2>
                <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">
                  Start a new session to receive real-time feedback on your
                  English
                </p>
              </div>
              <div className="px-6 py-6">
                {/* 상태 표시줄 */}
                <div className="flex items-center gap-3 mb-6 pb-5 border-b border-zinc-100 dark:border-zinc-800">
                  <div
                    className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                      isRecording
                        ? "bg-red-500 animate-pulse"
                        : "bg-zinc-200 dark:bg-zinc-700"
                    }`}
                  />
                  <span className="text-sm text-zinc-600 dark:text-zinc-400">
                    {isRecording ? "Recording in progress" : "Not recording"}
                  </span>
                </div>

                {/* 버튼 */}
                <div className="flex gap-3">
                  <button
                    onClick={handleStart}
                    disabled={isRecording || !isModelReady}
                    className="flex items-center gap-2 px-4 py-2 bg-zinc-900 dark:bg-white hover:bg-zinc-700 dark:hover:bg-zinc-100 disabled:bg-zinc-100 dark:disabled:bg-zinc-800 disabled:text-zinc-400 dark:disabled:text-zinc-600 text-white dark:text-zinc-900 text-sm font-medium rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed"
                  >
                    <MicrophoneIcon className="w-4 h-4" />
                    Start Session
                  </button>
                  <button
                    onClick={handleStop}
                    disabled={!isRecording}
                    className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700 disabled:opacity-40 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 text-sm font-medium rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed"
                  >
                    <StopIcon className="w-4 h-4" />
                    Stop & Save
                  </button>
                </div>
              </div>
            </div>

            {/* 최근 세션 utterances 테이블 — 리포트 직후 표시 */}
            {showReport &&
              !selectedSessionMarkdown &&
              utterances.length > 0 && (
                <div className="mt-5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
                  <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800">
                    <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      Transcript
                    </h2>
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-zinc-100 dark:border-zinc-800">
                        <th className="px-6 py-3 text-left font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                          Time
                        </th>
                        <th className="px-6 py-3 text-left font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                          You said
                        </th>
                        <th className="px-6 py-3 text-left font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800">
                      {utterances.map((u, idx) => (
                        <tr
                          key={idx}
                          className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                        >
                          <td className="px-6 py-3 font-mono text-zinc-400 dark:text-zinc-500 tabular-nums whitespace-nowrap">
                            {u.timestamp}
                          </td>
                          <td className="px-6 py-3 text-zinc-700 dark:text-zinc-300">
                            {u.feedback.original}
                          </td>
                          <td className="px-6 py-3">
                            {u.feedback.has_error ? (
                              <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400">
                                Error
                              </span>
                            ) : (
                              <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400">
                                Good
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </main>

          {/* 오른쪽 패널 */}
          <aside className="w-72 shrink-0 border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
              <h3 className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                {rightPanelTitle}
              </h3>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {isRecording ? (
                <FeedbackSidebar
                  latestFeedback={latestFeedback}
                  isVisible={true}
                />
              ) : showReport ? (
                <SessionReport
                  utterances={utterances}
                  reportPath={reportPath}
                  isVisible={true}
                  markdownContent={selectedSessionMarkdown}
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-2 select-none">
                  <p className="text-xs text-zinc-400 dark:text-zinc-600 text-center leading-relaxed">
                    Select a session from the sidebar
                    <br />
                    or start a new recording
                  </p>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

export default App;
