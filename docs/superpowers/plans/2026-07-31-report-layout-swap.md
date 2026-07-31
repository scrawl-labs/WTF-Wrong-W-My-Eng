# Report Layout Swap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Swap the report-view content between the main content area and the
right sidebar so the important stuff (corrections, vocabulary) lives in the
big center area with tabs, and the sidebar becomes a simple scrolling log.

**Architecture:** `SessionReport.tsx` (currently rendered in the sidebar)
moves to the main content area and gains a tab switcher (Corrections /
Vocabulary) above its existing Overview stats. A new `SessionLog.tsx`
component takes over the sidebar, rendering the full utterance list with
good/bad badges — this is the content that used to live in `<main>` as a
table. No backend/IPC changes; this is a pure frontend layout refactor.

**Tech Stack:** React + TypeScript, Tailwind CSS (existing project
conventions — no new dependencies).

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-07-31-report-layout-swap-design.md` — follow it exactly.
- This only changes the **report-view** state (`showReport === true`, not recording). The live-recording view in both `<main>` and `<aside>` must be untouched.
- `SessionReport`'s public props stay exactly the same: `{ utterances: Utterance[]; reportPath?: string; isVisible: boolean; markdownContent?: string }`. Only its internal rendering and its call site change.
- Default active tab in `SessionReport` is always `"corrections"` — no auto-switching based on content.
- Old markdown-only sessions (no JSON sidecar) keep the existing `<pre>` raw-markdown fallback inside `SessionReport`, now shown in the bigger main area instead of the sidebar.
- No automated frontend tests exist in this codebase (established convention) — verification is `npm run build` (type-check) plus manual `npm run tauri dev` checks.
- UI copy stays in English, matching every existing string in the app (`"No speech was captured in this session."`, `"Select a session from the sidebar"`, etc.) — only code comments are Korean, matching the codebase's existing convention.

---

### Task 1: Create `SessionLog.tsx`

**Files:**
- Create: `src/components/SessionLog.tsx`

**Interfaces:**
- Produces: `SessionLog({ utterances }: { utterances: Utterance[] })` — a component with no internal state, consumed by `App.tsx` in Task 3.
- Consumes: `Utterance` type from `src/types/index.ts` (already exists — `{ timestamp: string; feedback: FeedbackResult }`, and `FeedbackResult.has_error: boolean`, `FeedbackResult.original: string`).

- [ ] **Step 1: Write the component**

```tsx
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
```

- [ ] **Step 2: Type-check**

Run: `cd /Users/taek/Desktop/yongtaek/wtf-is-wrong-with-your-english && npm run build`
Expected: `tsc && vite build` succeeds with no type errors. (The component isn't imported anywhere yet — that's fine, it's not a build error for a file to be unused.)

- [ ] **Step 3: Commit**

```bash
cd /Users/taek/Desktop/yongtaek/wtf-is-wrong-with-your-english
git add src/components/SessionLog.tsx
git commit -m "feat: add SessionLog component for sidebar utterance log"
```

---

### Task 2: Refactor `SessionReport.tsx` into tabs

**Files:**
- Modify: `src/components/SessionReport.tsx` (full-file rewrite — see below)

**Interfaces:**
- Produces: same public signature as before — `SessionReport({ utterances, reportPath, isVisible, markdownContent }: SessionReportProps)`. Internal behavior changes (adds a tab switcher); the component's location in the tree changes in Task 3, not here.
- Consumes: `Utterance`/`FeedbackResult` shape from `src/types/index.ts` (unchanged).

- [ ] **Step 1: Read the current file to confirm you're replacing the right content**

Run: `cat /Users/taek/Desktop/yongtaek/wtf-is-wrong-with-your-english/src/components/SessionReport.tsx`

Confirm it matches this structure before replacing: a `SessionReportProps` interface, an early-return for `!isVisible`, an early-return for the markdown fallback, an early-return for the empty-utterances case, then a `space-y-6` div containing an "Overview" stats grid, a conditional "New Vocabulary" section, a conditional "Corrections" section (bulleted cards), and a `reportPath` footer. If the file looks substantially different from this description, STOP and report NEEDS_CONTEXT — someone else may have changed it since this plan was written.

- [ ] **Step 2: Replace the whole file**

Replace the entire contents of `src/components/SessionReport.tsx` with:

```tsx
import { useState } from "react";
import { Utterance } from "../types";

interface SessionReportProps {
  utterances: Utterance[];
  reportPath?: string;
  isVisible: boolean;
  markdownContent?: string;
}

type ReportTab = "corrections" | "vocabulary";

export function SessionReport({
  utterances,
  reportPath,
  isVisible,
  markdownContent,
}: SessionReportProps) {
  const [activeTab, setActiveTab] = useState<ReportTab>("corrections");

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
  const corrections = utterances.filter((u) => u.feedback.has_error);

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

      {/* 탭 전환: Corrections / Vocabulary */}
      <div>
        <div className="flex gap-1 border-b border-zinc-100 dark:border-zinc-800 mb-4">
          {(
            [
              { key: "corrections", label: "Corrections" },
              { key: "vocabulary", label: "Vocabulary" },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors cursor-pointer ${
                activeTab === key
                  ? "border-zinc-900 dark:border-white text-zinc-900 dark:text-white"
                  : "border-transparent text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {activeTab === "corrections" ? (
          corrections.length > 0 ? (
            <div className="space-y-3">
              {corrections.map((u, idx) => (
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
          ) : (
            <p className="text-xs text-zinc-400 dark:text-zinc-600 text-center py-6">
              No corrections needed — nice work!
            </p>
          )
        ) : vocabItems.length > 0 ? (
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
        ) : (
          <p className="text-xs text-zinc-400 dark:text-zinc-600 text-center py-6">
            No new vocabulary this session.
          </p>
        )}
      </div>

      {reportPath && (
        <p className="text-xs text-zinc-400 dark:text-zinc-600 font-mono truncate pt-2 border-t border-zinc-100 dark:border-zinc-800">
          {reportPath}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `cd /Users/taek/Desktop/yongtaek/wtf-is-wrong-with-your-english && npm run build`
Expected: succeeds with no type errors. `App.tsx` still imports and renders the old-shaped `<SessionReport>` in the sidebar at this point — since the props interface is unchanged, this must still compile cleanly even though the visual result (still in the sidebar, now with tabs crammed into a narrow w-80 column) will look wrong until Task 3 moves it. That's expected and temporary.

- [ ] **Step 4: Commit**

```bash
cd /Users/taek/Desktop/yongtaek/wtf-is-wrong-with-your-english
git add src/components/SessionReport.tsx
git commit -m "feat: add Corrections/Vocabulary tabs to SessionReport"
```

---

### Task 3: Wire the swap into `App.tsx`

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `SessionLog` from Task 1 (`{ utterances: Utterance[] }`), the refactored `SessionReport` from Task 2 (same props as before).

- [ ] **Step 1: Add the `SessionLog` import**

In `src/App.tsx`, find this existing import line:

```tsx
import { SessionReport } from "./components/SessionReport";
```

Add a new line immediately after it:

```tsx
import { SessionLog } from "./components/SessionLog";
```

- [ ] **Step 2: Replace the main-content utterances table with `<SessionReport>`**

Find this block in `src/App.tsx` (it starts right after the closing `) : null}` of the recording/idle-dashboard conditional, and ends right before the `</main>` closing tag):

```tsx
            {/* 최근 세션 utterances 테이블 — 리포트 직후 또는 과거 세션 선택 시 표시 */}
            {showReport && utterances.length === 0 && !selectedSessionMarkdown && (
              <div className="mt-5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-12 flex flex-col items-center justify-center gap-2 text-center">
                <DocumentTextIcon className="w-6 h-6 text-zinc-300 dark:text-zinc-700" />
                <p className="text-xs text-zinc-400 dark:text-zinc-600">
                  No speech was captured in this session.
                </p>
              </div>
            )}
            {showReport && utterances.length > 0 && (
              <div className="mt-5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800">
                  <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    Corrections
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
                              Needs correction
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
```

Replace that entire block (from the `{/* 최근 세션 utterances 테이블... */}` comment through the `</main>` tag) with:

```tsx
            {/* 리포트 상세 — 통계 + Corrections/Vocabulary 탭 (리포트 직후 또는 과거 세션 선택 시 표시) */}
            {showReport && (
              <div className="mt-5">
                <SessionReport
                  utterances={utterances}
                  reportPath={reportPath}
                  isVisible={true}
                  markdownContent={selectedSessionMarkdown}
                />
              </div>
            )}
          </main>
```

- [ ] **Step 3: Replace the sidebar's `<SessionReport>` with `<SessionLog>`**

Find this block (inside the `<aside>`'s content div, the `showReport` branch of the ternary chain):

```tsx
              ) : showReport ? (
                <SessionReport
                  utterances={utterances}
                  reportPath={reportPath}
                  isVisible={true}
                  markdownContent={selectedSessionMarkdown}
                />
              ) : (
```

Replace it with:

```tsx
              ) : showReport ? (
                <SessionLog utterances={utterances} />
              ) : (
```

- [ ] **Step 4: Type-check**

Run: `cd /Users/taek/Desktop/yongtaek/wtf-is-wrong-with-your-english && npm run build`
Expected: succeeds with no type errors. `DocumentTextIcon` is still used elsewhere in `App.tsx` (the sidebar's "Transcript" toggle button icon) so no unused-import error is expected from removing it out of the deleted block.

- [ ] **Step 5: Manual verification**

Run: `cd /Users/taek/Desktop/yongtaek/wtf-is-wrong-with-your-english && npm run tauri dev`

- Start a new recording, speak a few sentences with at least one that should get flagged as needing correction, then Stop & Save.
- Confirm the report screen shows: main (center, big area) has Overview stats + Corrections/Vocabulary tabs; sidebar (right) has the scrolling log with timestamps + good/bad badges.
- Click the Vocabulary tab, confirm it shows learned expressions (or the empty state if none).
- Click back to Corrections tab, confirm corrections show with original/corrected/better-expression.
- Select an older JSON-backed session from the sidebar list — confirm the same layout appears.
- If there's an old markdown-only session available (pre-JSON-sidecar), select it — confirm main shows the raw markdown fallback and the sidebar shows "No structured log available for this session."
- Start a new live recording — confirm the recording-in-progress views (main's "Recording" card, sidebar's mic-icon placeholder) are unchanged from before this plan.
- Resize the window narrower/shorter and confirm both the main tab content and the sidebar log scroll independently without clipping (regression check against the earlier `min-h-0` scroll fix).

- [ ] **Step 6: Commit**

```bash
cd /Users/taek/Desktop/yongtaek/wtf-is-wrong-with-your-english
git add src/App.tsx
git commit -m "refactor: swap report layout — tabs in main, log in sidebar"
```

---

## Self-Review Notes

- **Spec coverage:** main/aside content swap → Task 3; SessionReport tabs (Corrections/Vocabulary, default Corrections, per-tab empty states) → Task 2; SessionLog with timestamp+text+badge → Task 1; Overview stats stay at top of main → Task 2 (unchanged position within SessionReport, which itself moves to main in Task 3); markdown fallback preserved → Task 2 (kept verbatim); duplicate empty-state cleanup in App.tsx → Task 3 Step 2 (old block deleted entirely, SessionReport's own empty-state handles it now); live-recording view untouched → explicitly not touched in any task, called out as a Global Constraint and verified in Task 3's manual check.
- **Placeholder scan:** none found — every step has literal, complete code.
- **Type consistency:** `SessionReportProps` identical before/after (Task 2 keeps the exact same interface). `SessionLogProps` (`{ utterances: Utterance[] }`) matches its only call site in Task 3 Step 3 (`<SessionLog utterances={utterances} />`). Both components import `Utterance` from the same `../types` module already used throughout `App.tsx`.
