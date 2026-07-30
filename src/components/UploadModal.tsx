// src/components/UploadModal.tsx
// 녹음 파일 업로드 모달 - 드래그앤드롭 영역 + 네이티브 파일 선택 버튼
//
// Tauri 웹뷰는 기본적으로 OS 레벨 파일 드롭을 가로채서 브라우저의 HTML5
// ondrop 이벤트에는 실제 파일 경로가 전달되지 않는다. 대신
// getCurrentWindow().onDragDropEvent()로 받아야 한다.
//
// 실제 DragDropEvent 유니온(@tauri-apps/api/webview.d.ts 기준):
//   { type: "enter"; paths: string[]; position } | { type: "over"; position }
//   | { type: "drop"; paths: string[]; position } | { type: "leave" }
// "enter"가 드래그 진입 시 먼저 발생하고 이후 "over"가 반복 발생하므로,
// 호버 표시는 "enter"와 "over" 둘 다에서 켜야 한다.

import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { XMarkIcon, DocumentArrowUpIcon } from "@heroicons/react/20/solid";
import { SessionProgress } from "../types";

const SUPPORTED_EXTENSIONS = ["wav", "mp3", "m4a"];

interface UploadModalProps {
  onClose: () => void;
  onUpload: (path: string) => void;
  processing: boolean;
  progress: SessionProgress | null;
  error: string;
}

export function UploadModal({
  onClose,
  onUpload,
  processing,
  progress,
  error,
}: UploadModalProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => {
    const unlisten = getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type === "enter" || event.payload.type === "over") {
        setIsDragOver(true);
      } else if (event.payload.type === "drop") {
        setIsDragOver(false);
        // 이미 업로드 처리 중이면 새 드롭을 무시 - 동시 업로드 방지
        if (processing) {
          return;
        }
        const first = event.payload.paths[0];
        if (first && isSupported(first)) {
          onUpload(first);
        }
      } else {
        setIsDragOver(false);
      }
    });
    return () => {
      unlisten.then((u) => u());
    };
  }, [onUpload, processing]);

  const isSupported = (path: string) => {
    const ext = path.split(".").pop()?.toLowerCase();
    return !!ext && SUPPORTED_EXTENSIONS.includes(ext);
  };

  const handlePickFile = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Audio", extensions: SUPPORTED_EXTENSIONS }],
    });
    if (typeof selected === "string") {
      onUpload(selected);
    }
  };

  const progressLabel = (p: SessionProgress) => {
    if (p.stage === "decoding_audio") return "Decoding audio…";
    if (p.stage === "transcribing") return `Transcribing… ${p.current}%`;
    return `Generating feedback… ${p.current}/${p.total}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 dark:border-zinc-800">
          <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Upload a recording
          </h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5">
          {error && (
            <p className="text-xs text-red-600 dark:text-red-400 mb-3 whitespace-pre-wrap">
              {error}
            </p>
          )}

          {processing ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <DocumentArrowUpIcon className="w-8 h-8 text-zinc-300 dark:text-zinc-700 animate-pulse" />
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {progress ? progressLabel(progress) : "Starting…"}
              </p>
            </div>
          ) : (
            <button
              onClick={handlePickFile}
              className={`w-full flex flex-col items-center gap-3 py-10 border-2 border-dashed rounded-lg transition-colors cursor-pointer ${
                isDragOver
                  ? "border-zinc-400 dark:border-zinc-500 bg-zinc-50 dark:bg-zinc-800"
                  : "border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600"
              }`}
            >
              <DocumentArrowUpIcon className="w-8 h-8 text-zinc-300 dark:text-zinc-700" />
              <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center px-6">
                Drag a recording here, or click to choose a file
                <br />
                <span className="text-xs text-zinc-400 dark:text-zinc-600">
                  wav, mp3, m4a
                </span>
              </p>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
