import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowPathIcon,
  DocumentTextIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "@heroicons/react/20/solid";
import appIcon from "../assets/app-icon.png";

export interface SessionInfo {
  filename: string;
  title: string;
  path: string;
}

interface SessionListProps {
  selectedSession: SessionInfo | null;
  onSelectSession: (session: SessionInfo) => void;
  refreshKey?: number;
}

export function SessionList({
  selectedSession,
  onSelectSession,
  refreshKey,
}: SessionListProps) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  const loadSessions = async () => {
    try {
      setLoading(true);
      const list = await invoke<SessionInfo[]>("list_sessions");
      setSessions(list);
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSessions();
  }, [refreshKey]);

  return (
    <nav
      className={`flex flex-col shrink-0 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 border-r border-zinc-200 dark:border-transparent overflow-hidden transition-[width] duration-200 ${
        collapsed ? "w-16" : "w-56"
      }`}
    >
      {/* 앱 로고 영역 */}
      <div
        className={`flex items-center justify-between h-16 shrink-0 border-b border-zinc-200 dark:border-zinc-800 ${
          collapsed ? "px-2" : "px-4"
        }`}
      >
        <img
          src={appIcon}
          alt="Scoldler"
          className="w-6 h-6 rounded shrink-0"
        />
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="p-1 rounded text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors shrink-0"
        >
          {collapsed ? (
            <ChevronRightIcon className="w-3.5 h-3.5" />
          ) : (
            <ChevronLeftIcon className="w-3.5 h-3.5" />
          )}
        </button>
      </div>

      {/* Sessions 섹션 */}
      <div
        className={`flex-1 overflow-y-auto py-3 ${collapsed ? "px-1.5" : "px-2"}`}
      >
        {!collapsed && (
          <div className="flex items-center justify-between px-2 mb-2">
            <span className="text-xs font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
              Sessions
            </span>
            <button
              onClick={loadSessions}
              className="p-1 rounded text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors"
            >
              <ArrowPathIcon className="w-3 h-3" />
            </button>
          </div>
        )}

        {loading ? (
          !collapsed && (
            <div className="px-2 py-4 text-xs text-zinc-400 dark:text-zinc-600">
              Loading...
            </div>
          )
        ) : sessions.length === 0 ? (
          !collapsed && (
            <div className="px-2 py-6 flex flex-col items-center gap-2 text-center">
              <DocumentTextIcon className="w-6 h-6 text-zinc-300 dark:text-zinc-700" />
              <p className="text-xs text-zinc-400 dark:text-zinc-600 leading-relaxed">
                No sessions yet.
                <br />
                Start recording to create one.
              </p>
            </div>
          )
        ) : (
          <ul className="space-y-0.5">
            {sessions.map((session) => {
              const isSelected = selectedSession?.filename === session.filename;
              return (
                <li key={session.filename}>
                  <button
                    onClick={() => onSelectSession(session)}
                    title={collapsed ? session.title : undefined}
                    className={`w-full text-left rounded-md text-xs transition-colors ${
                      collapsed ? "flex justify-center p-2" : "px-2 py-2"
                    } ${
                      isSelected
                        ? "bg-zinc-900/5 dark:bg-white/10 text-zinc-900 dark:text-white"
                        : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-900/5 dark:hover:bg-white/5 hover:text-zinc-700 dark:hover:text-zinc-200"
                    }`}
                  >
                    {collapsed ? (
                      <DocumentTextIcon className="w-4 h-4 shrink-0" />
                    ) : (
                      <>
                        <div className="font-medium truncate">
                          {session.title}
                        </div>
                        <div className="text-zinc-400 dark:text-zinc-600 font-mono truncate mt-0.5 text-[10px]">
                          {session.filename.replace(".md", "")}
                        </div>
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </nav>
  );
}
