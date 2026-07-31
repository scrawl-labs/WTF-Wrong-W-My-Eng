# 리포트 화면 레이아웃 개편 설계

## 배경 / 목표

리포트를 보는 화면(녹음 완료 직후 또는 사이드바에서 과거 세션 선택 시)에서, 현재
가장 넓은 영역인 가운데(main)에는 단순 발화 로그 테이블만 있고, 정작 핵심
기능인 교정 내용과 새 단어는 좁은 오른쪽 사이드바(aside, w-80)에 몰려 있다.
중요도와 화면 배치가 반대로 되어 있다는 피드백에 따라 두 영역의 콘텐츠를
맞바꾼다.

라이브 녹음 중 화면(마이크 아이콘, "Recording..." 카드)은 이 변경과 무관하다 —
리포트를 "보는" 화면에만 해당하는 변경이다.

## 변경 후 레이아웃

```
지금:  main  = 전체 로그 테이블 (Time / You said / Status)
       aside = Overview 통계 + New Vocabulary + Corrections 상세

변경후: main  = Overview 통계 + [Corrections | Vocabulary] 탭
        aside = 전체 로그 (타임스탬프 + 원문 + good/bad 배지, 좁은 폭용 리스트)
```

## 컴포넌트

### `src/components/SessionReport.tsx` (기존 컴포넌트, 배치만 aside → main으로 이동)

내부 구조를 탭 기반으로 바꾼다:

- 상단: Overview 통계 카드 3개 (Utterances / Corrections / Vocab) — 기존과 동일한
  스타일, 위치만 유지.
- 그 아래: 탭 전환 UI — `Corrections`, `Vocabulary` 두 개. 기본 선택 탭은
  `Corrections`. 로컬 `useState`로 관리 (`activeTab: "corrections" | "vocabulary"`).
- `Corrections` 탭: `has_error`인 발화만, 카드 형태로 상세히 (원문 / 교정 /
  더 자연스러운 표현) — 지금 aside의 Corrections 카드와 동일한 내용, 탭 안으로
  이동. 교정할 게 없으면 "교정할 내용이 없습니다" 같은 빈 상태 문구.
- `Vocabulary` 탭: 지금 aside의 New Vocabulary 리스트와 동일한 내용, 탭 안으로
  이동. 새 표현이 없으면 "새로 배운 표현이 없습니다" 같은 빈 상태 문구.
- `reportPath` 푸터: 탭 내용 아래, 기존과 동일하게 유지.
- 옛날 세션(JSON 사이드카 없이 마크다운만 있는 경우) 폴백은 그대로 유지 —
  `utterances.length === 0 && markdownContent`일 때 지금처럼 raw 마크다운을
  `<pre>`로 보여준다. 탭 UI 없이.
- props는 지금과 동일: `utterances`, `reportPath`, `isVisible`, `markdownContent`.
  시그니처 변경 없음 — App.tsx에서 렌더링 위치만 바뀐다.

### `src/components/SessionLog.tsx` (신규)

전체 발화 로그를 사이드바 폭(w-80)에 맞는 세로 리스트로 표시한다. 각 항목:
타임스탬프(모노스페이스, 작게) → 원문 텍스트 → Good / Needs correction 배지
(지금 main의 테이블에서 쓰던 것과 동일한 배지 스타일, 색상 그대로 재사용).
발화가 없으면(예: 옛날 마크다운 전용 세션, 또는 실제로 빈 세션) "구조화된
로그가 없습니다" 같은 빈 상태 문구.

```typescript
interface SessionLogProps {
  utterances: Utterance[];
}
```

### `src/App.tsx`

- `<main>` 안의 기존 "Corrections 테이블" 블록(현재 `showReport && utterances.length > 0`
  조건의 테이블 카드, 대략 524~580번째 줄 대)을 삭제하고 그 자리에
  `<SessionReport utterances={utterances} reportPath={reportPath} isVisible={showReport} markdownContent={selectedSessionMarkdown} />`
  를 렌더링.
- 기존에 main에 있던 "발화 없음" 빈 상태 카드(524번째 줄, `showReport &&
  utterances.length === 0 && !selectedSessionMarkdown`)는 삭제 — SessionReport가
  자체적으로 이 케이스를 처리하므로 중복 제거.
- `<aside>` 안의 `<SessionReport>` 렌더링을 `<SessionLog utterances={utterances} />`
  로 교체. (aside는 `showReport` 브랜치일 때만 이 컴포넌트를 그리는 지금 구조
  그대로 유지 — 녹음 중/설정 중/세션 미선택 상태의 다른 분기들은 안 건드림)
- aside 헤더의 "Transcript" 토글 버튼, 오른쪽 패널 제목(`rightPanelTitle`) 등
  기존 로직은 그대로 유지 — 이번 변경은 `showReport`이고 `!showTranscript`인
  경우에 aside에 무엇을 그리는지만 바꾼다.

## 데이터 흐름

변경 없음 — `utterances`/`reportPath`/`selectedSessionMarkdown` 상태는 지금과
동일하게 `App.tsx`에서 관리되고, 두 컴포넌트에 그대로 전달된다. 백엔드/IPC
변경 전혀 없음. 순수 프론트엔드 레이아웃 리팩터링.

## 에러 처리

기존과 동일 — 이 변경은 렌더링 위치 재배치와 탭 UI 추가일 뿐, 에러 처리
로직(세션 로드 실패 시 `errorMsg` 등)은 손대지 않는다.

## 테스트

이 프로젝트에는 프론트엔드 자동 테스트가 없다 (기존 관례). `npm run build`로
타입 체크 통과를 확인하고, `npm run tauri dev`로 다음을 수동 확인한다:

- 새 세션 녹음 완료 직후 리포트 화면: main에 통계+탭, aside에 로그
- 사이드바에서 과거 JSON 세션 선택: 동일하게 동작
- 사이드바에서 과거 마크다운 전용(옛날) 세션 선택: main에 raw 마크다운 폴백,
  aside에 "구조화된 로그 없음" 문구
- Corrections/Vocabulary 탭 전환 동작, 각 탭의 빈 상태 문구
- 라이브 녹음 중 화면은 기존과 동일하게 동작 (회귀 없음)

## 범위에서 제외한 것

- 교정이 0건일 때 자동으로 Vocabulary 탭으로 전환하는 등의 스마트 기본 탭
  선택 — 항상 `Corrections` 탭을 기본으로 고정, 각 탭이 빈 상태를 스스로 표시.
- aside 로그 리스트에 필터/검색 등 추가 기능 — 이번 범위는 배치 이동만.
