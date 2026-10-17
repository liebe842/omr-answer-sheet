# 갱지 답안지 리디자인 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 학생·선생님 화면 전체를 "초등 갱지 단원평가 답안지" 디자인으로 다시 만든다(서버 로직은 그대로).

**Architecture:** Apps Script `HtmlService` 템플릿 include로 클라이언트를 `index.html`(마크업 뼈대) + `styles.html` + `app-common.html` + `app-student.html` + `app-teacher.html`로 나눈다. 테스트는 로컬 미리보기(`dev/preview.mjs`가 include를 펼치고 가짜 `google.script.run` 스텁과 브라우저 셀프테스트를 주입)로 하고, Playwright로 셀프테스트 결과와 화면을 확인한다.

**Tech Stack:** Google Apps Script(V8) + HtmlService, 순수 HTML/CSS/JS(빌드 없음), Google Fonts(Gowun Batang, Nanum Gothic, Nanum Pen Script), Node 24(미리보기 생성만), Playwright MCP(검증).

**Spec:** `docs/superpowers/specs/2026-10-17-paper-answer-sheet-redesign-design.md` — 모든 태스크 실행자는 스펙을 함께 읽는다. 시안: `.superpowers/brainstorm/2139-1792206029/content/student-flow.html`, `teacher-view.html`.

## Global Constraints

- 색은 `:root` 토큰만: `--desk #b9bfb3`, `--paper #ebe6d6`, `--paper-shade rgba(0,0,0,.05)`, `--ink #1f1f1d`, `--ink-soft #3b3f37`, `--red-pen #d6262b`. `--red-pen`은 선생님 채점 표시·점수·정답 표기·한 말씀·도장에만.
- 글꼴: 제목 Gowun Batang 700, 본문·입력 Nanum Gothic 400/700/800, 빨간 펜 Nanum Pen Script. Jua·Gowun Dodum·canvas-confetti 제거. 없는 굵기로 가짜 볼드 금지.
- 이모지·그라데이션·카드 그림자 금지. 종이 그림자는 `0 1px 2px` 하나. 표·종이·버튼 radius 0–2px.
- `alert`/`confirm`/`prompt` 사용 금지. 안내는 `showToast`, 확인은 인라인.
- 모든 클릭 요소는 `button`/`input`/`label`. 모든 상호작용 요소에 `:focus-visible` 링(잉크 2px + offset). `prefers-reduced-motion`이면 전환·도장 모션 없음.
- 버블 터치 영역 ≥ 44px. 360px 폭에서 페이지 가로 스크롤 없음(넓은 표는 `overflow-x:auto` 래퍼).
- 사용자 입력 문자열을 인라인 `onclick="...'${str}'..."`에 넣지 않는다. 숫자 id나 `data-*` + 이벤트 위임.
- `google.script.run` 서버 함수 이름·인자는 유지. `omrTheme` 서버 키 유지, UI 제거, 저장 시 `'blue'` 고정 전달.
- UI 문구는 짧은 평서문, 느낌표 남발 금지. 버튼 이름 = 결과 토스트 동사(예: "저장" → "저장했어요").
- 코드 주석은 기존처럼 한국어, 기존 밀도.

## Review Focus

1. 이름·답에 `<`, `"`, `'` 가 들어간 학생 → 모든 화면에서 글자 그대로 보이고 깨지거나 스크립트가 실행되지 않는다. (Task 3, 6 셀프테스트)
2. 채점 저장 실패/권한 오류 → 칸 표시가 원래대로 돌아가고 오류 토스트, 다른 학생 행 표시가 바뀌지 않는다. (Task 6)
3. `localStorage` 접근이 예외를 던지는 브라우저 → 제출·대기·결과가 정상 동작(복귀만 안 됨). (Task 4)
4. 부분점수 입력이 빈칸·음수·배점 초과·문자 → 저장하지 않고 칸 옆 인라인 오류. 소수(예 7.5)는 허용. (Task 6)
5. 다빈칸 문항(선택형 2칸, 단답 2칸) → 제출 payload가 `{qNum: [칸1, 칸2]}`, 대기 화면 읽기 전용 표시와 결과 표시가 칸별로 맞다. (Task 3, 4)

---

## File Structure

| 파일 | 책임 |
|---|---|
| `index.html` (재작성) | `<head>` 폰트 링크, `<?!= include('styles') ?>`, 학생/선생님/모달/토스트 컨테이너 마크업, 스크립트 include 3개 |
| `styles.html` (신규) | `<style>` 전체: 토큰, 종이·책상, 표, 버블, 입력, 버튼, 탭, 스위치, 토스트, 도장, 반응형, 포커스, reduced-motion |
| `app-common.html` (신규) | `<script>` 공용: `serverCall`, `showToast`, `escapeHtml`, 유형 헬퍼, 모드 전환 |
| `app-student.html` (신규) | `<script>` 학생 화면 ①②③ + 저장/복귀 |
| `app-teacher.html` (신규) | `<script>` 선생님 화면: 로그인, 상단 줄, 탭, 채점, 결과 보기, 정답과 설정 |
| `Code.js` (수정) | `include(name)` 추가, 메시지 문구 정리 |
| `.claspignore` (신규) | `dev/**`, `docs/**`, `.superpowers/**`, `.playwright-mcp/**`, `*.md` 업로드 제외 |
| `dev/preview.mjs` (신규) | include 펼치기 + 스텁·셀프테스트 주입 → `dev/out/preview.html` |
| `dev/stub-gas.js` (신규) | 메모리 가짜 서버(시나리오별 데이터), 서버 응답 형태·완료 규칙 재현 |
| `dev/selftest.js` (신규) | `?selftest=1`일 때 실행되는 `test()`/`assertEq()` 러너와 테스트들, 결과를 `window.__selftest = {pass, fail, failures[]}`와 콘솔에 기록 |

`.gitignore`에 `dev/out/` 추가.

---

### Task 1: 파일 분리 뼈대 + 미리보기·셀프테스트 하네스

**Files:**
- Create: `styles.html`, `app-common.html`, `app-student.html`, `app-teacher.html`, `.claspignore`, `dev/preview.mjs`, `dev/stub-gas.js`, `dev/selftest.js`
- Modify: `index.html` (전체 재작성 시작), `Code.js:10-16` (`include` 추가), `.gitignore`

**Interfaces:**
- Produces (Code.js): `function include(name) { return HtmlService.createHtmlOutputFromFile(name).getContent(); }`
- Produces (app-common): `serverCall(fnName: string, payload?: any) => Promise<any>` (failure → reject(Error)); `showToast(message: string, kind?: 'info'|'error') => void` (`#toast` 영역, 2500ms 후 사라짐, `role="status"`); `escapeHtml(str) => string` (`& < > " '` 이스케이프); `CHOICE_TYPES = ['객관식','기호(ㄱ,ㄴ,ㄷ)','기호(가,나,다)','OX퀴즈']`; `isChoiceType(qType) => boolean`; `getBubbleOptionsForType(qType) => string[]` (기존 값 그대로); `setMode('student'|'teacher') => void` (`#studentView`/`#teacherView` 토글).
- Produces (dev): `node dev/preview.mjs` → `dev/out/preview.html`. URL 쿼리 `?scenario=<name>` 로 스텁 데이터 선택, `?selftest=1` 로 셀프테스트 실행. 시나리오: `fresh`(문항 6개: 객관식1칸, 객관식2칸, 기호(ㄱ,ㄴ,ㄷ), OX, 단답2칸, 서술형), `empty`(문항 0개), `teacher`(제출 5명: 완료 2·대기 3, 이름 하나는 `<b>"민'수"</b>`), `perfect`(만점 결과 공개). 스텁은 `updateStudentQuestionGrade`에서 실제 서버와 같은 규칙 `isCompleted = forceComplete !== undefined ? forceComplete : !hasPending` 를 따르고 `{success, newTotalScore, isCompleted}`를 돌려준다. `?fail=updateStudentQuestionGrade` 면 그 함수는 `{success:false, message:'권한이 없습니다.'}`.
- Produces (selftest): 전역 `test(name, fn)`, `assertEq(actual, expected, msg)`, `assertTrue(v, msg)`; 각 앱 파일 테스트는 `dev/selftest.js` 안에 태스크별 블록으로 추가.

- [ ] **Step 1:** `dev/selftest.js`에 첫 테스트 작성: `escapeHtml('<b>"민\'수"</b>')` === `'&lt;b&gt;&quot;민&#39;수&quot;&lt;/b&gt;'`, `getBubbleOptionsForType('OX퀴즈')` 깊은비교 `['O','X']`, `isChoiceType('단답식') === false`.
- [ ] **Step 2:** `dev/preview.mjs`, `dev/stub-gas.js` 작성 후 `node dev/preview.mjs` 실행, Playwright로 `file:///.../dev/out/preview.html?scenario=fresh&selftest=1` 열고 `window.__selftest` 확인. Expected: 앱 함수 미정의로 FAIL.
- [ ] **Step 3:** `Code.js`에 `include` 추가. `index.html`을 뼈대로 재작성(빈 `#studentView`, `#teacherView`, `#passwordModal`, `#toast`), 새 폰트 링크, include 4개. `app-common.html` 구현. 나머지 app 파일은 빈 `<script>`. `.claspignore`, `.gitignore`(`dev/out/`) 작성.
- [ ] **Step 4:** 미리보기 재생성 후 셀프테스트. Expected: `fail === 0`.
- [ ] **Step 5:** `git add` 위 파일들 → `git commit -m "refactor: split client into include files and add local preview harness"`

> 시작 전 확인: 작업 트리에 이전 작업의 미커밋 변경(Code.js, index.html, CLAUDE.md)이 있다. 사용자에게 먼저 커밋할지 물은 뒤 진행한다.

### Task 2: 시각 체계 (styles.html)

**Files:** Modify: `styles.html`, `index.html`(데모 마크업 없음)

**Interfaces:**
- Produces (CSS 클래스, 이후 태스크가 사용): `.desk`(body 바탕), `.paper`(갱지 한 장, max-width 760px, 질감), `.paper-title`(명조 제목), `.sheet-table`(검은 1px 표; `th`는 `--paper-shade`), `.table-wrap`(overflow-x), `.bubble-group` + `.bubble`(버튼, `aria-pressed="true"`면 잉크 채움, 120ms), `.line-input`(밑줄 입력), `.essay-input`, `.btn-ink`(검은 직사각), `.btn-quiet`(테두리만), `.link-quiet`, `.red-pen`(Nanum Pen Script + `--red-pen`), `.mark-cells`/`.mark-cell`(채점 네모 칸, `aria-pressed` 시 빨간 바탕), `.score-input`, `.inline-note`(점선 상자 안내), `.inline-error`, `.toast`, `.index-tabs`/`.index-tab`(파일철 탭, `aria-selected`), `.ink-switch`(체크박스 기반 스위치), `.stamp`(만점 도장, `.stamp--hit` 애니메이션), `.dim`(opacity .55), `.visually-hidden`.
- 브레이크포인트: `max-width: 900px`(선생님 2단 → 1단), `max-width: 520px`(표 셀 패딩 축소, 버블 간격 축소).

- [ ] **Step 1:** `dev/selftest.js`에 스타일 테스트: `getComputedStyle(document.body).backgroundColor === 'rgb(185, 191, 179)'`; 임시 `.bubble` 생성 후 `getBoundingClientRect()` 높이·너비 ≥ 44(패딩 포함 터치 영역); `[aria-pressed=true].bubble` 배경 `rgb(31, 31, 29)`.
- [ ] **Step 2:** 미리보기+셀프테스트 실행. Expected: 이 테스트들 FAIL.
- [ ] **Step 3:** `styles.html` 구현(Global Constraints 값 그대로).
- [ ] **Step 4:** 셀프테스트 PASS 확인.
- [ ] **Step 5:** commit `feat: paper answer-sheet visual system`

### Task 3: 학생 ① 답 쓰는 중

**Files:** Modify: `index.html`(`#studentView` 마크업: 종이, 제목 `#examTitle`, 정보 표의 `<label for>` + `#studentNumber`/`#studentName`, `#answerTable`, `#emptyCheck`, `#submitBtn` "답안지 내기"), `app-student.html`, `dev/selftest.js`

**Interfaces:**
- Consumes: Task 1 `serverCall`, `showToast`, `escapeHtml`, `getBubbleOptionsForType`, `isChoiceType`; Task 2 클래스.
- Produces: `studentQuestions: Array<{qNum, qType, blankCount, points}>`; `studentAnswers: {[qNum]: string[]}`; `loadStudentScreen() => Promise<void>` (`getStudentInitData` 호출, 제목·문항 렌더, Task 4 복귀 확인 훅 `tryRestoreSubmission()` 호출); `renderAnswerSheet(questions, {readOnly?: boolean, answers?: object}) => string` (표 HTML; readOnly는 Task 4가 재사용); `findEmptyQuestions(questions, answers) => number[]` (qNum 목록); `submitAnswers({skipEmptyCheck?: boolean}) => Promise<void>`.
- 버블: `<button class="bubble" data-q data-b data-v aria-pressed>`, 같은 칸 다시 누르면 해제, 이벤트 위임. 객관식은 "다른 번호" `.line-input`(좁게) 유지, 입력값이 1–5면 해당 버블 표시 동기화. 다빈칸은 칸 안에 `(1)`, `(2)` 줄.
- 빈 칸 있으면 `#emptyCheck`에 "아직 안 쓴 문항이 있어요: 2번, 5번" + `그래도 내기` / `다시 보기`(첫 빈 문항으로 포커스). 번호·이름 빈칸이면 인라인 오류 + 포커스. 제출 중 버튼 비활성 "내는 중…". 서버 `{success:false}`는 메시지를 `.inline-error`로.

- [ ] **Step 1:** 테스트 작성 (`scenario=fresh`): 문항 6개 행 렌더; 2번 문항에 `(1)`,`(2)` 두 버블 그룹; 1번 버블 3 클릭 → `studentAnswers[1][0]==='3'`, 다시 클릭 → `''`; `findEmptyQuestions(studentQuestions, {1:['3'],2:['1',''],...})`에 2 포함; 번호·이름 채우고 모두 답한 뒤 `submitAnswers()` → 스텁이 받은 payload `answers[5]`가 길이 2 배열; 이름 `<b>"민'수"</b>`로 제출해도 DOM에 `<b>` 요소가 생기지 않음; `scenario=empty`에서 "등록된 문항이 없어요" 표시.
- [ ] **Step 2:** 실행 → FAIL.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS 확인 + 768px, 390px 스크린샷 육안 확인(시안 `student-flow.html` ①과 비교).
- [ ] **Step 5:** commit `feat: student answer sheet (writing state)`

### Task 4: 학생 ② 기다림 + 복귀, ③ 결과 + 도장

**Files:** Modify: `index.html`(`#waitingNote`, `#resultArea`, `#newStudentLink` "다른 학생이 새로 쓰기", `#backToStartBtn` "처음으로"), `app-student.html`, `dev/selftest.js`

**Interfaces:**
- Consumes: Task 3 `renderAnswerSheet`, `studentQuestions`, `loadStudentScreen`.
- Produces: `SAVED_KEY = 'omr.pendingSubmission.v1'`; `SAVED_TTL_MS = 12 * 60 * 60 * 1000`; `saveSubmission({studentNumber, studentName, answers, examTitle, submittedAt}) => void`; `readSavedSubmission(examTitle: string, now: number) => object|null` (없음·제목 다름·TTL 초과·JSON 오류·스토리지 예외면 null, 초과·불일치는 삭제); `clearSavedSubmission() => void`; 모두 try/catch. `tryRestoreSubmission() => boolean`; `showWaiting(saved) => void` (읽기 전용 흐린 답안지 + 점선 안내 "답안지를 냈어요. 선생님이 채점하시면 이 화면에 바로 나와요." + "마지막 확인 HH:MM" + 폴링 시작; 폴링은 기존 5s→×1.5→30s + 0–1s 지터 그대로); `markGlyph(status) => '○'|'△'|'/'|''` (`O`,`△`,`X`, 그 외 `''`); `renderResult(res) => void` (스펙 §5-③ 그대로: 채점 열, △ 옆 점수, `showCorrectAnswers`면 O 아닌 행에 `→ 정답`, 총점 동그라미 SVG, 한 말씀, `showScore` false 분기, 만점이면 `.stamp` + `.stamp--hit`).

- [ ] **Step 1:** 테스트: `readSavedSubmission` — 저장 직후 같은 제목·now → 객체; 다른 제목 → null; `submittedAt + SAVED_TTL_MS + 1` → null; `localStorage.getItem`을 throw하도록 바꾼 상태 → null이고 예외 없음. `markGlyph('O')==='○'`, `'X'`→`'/'`, `'△'`→`'△'`, `'보류'`→`''`. 제출 후 `#waitingNote` 보임·제출 폼 숨김; 페이지 재로드 시뮬레이션(`loadStudentScreen()` 재호출) 후에도 대기 화면. `newStudentLink` 클릭 → 저장 삭제 + 빈 답안지. `scenario=perfect` 결과 → `.stamp` 존재, 다빈칸 2번 행이 칸별 답 표시. `matchMedia('(prefers-reduced-motion: reduce)')` 에뮬레이션 시 `.stamp`의 animation-name `none`.
- [ ] **Step 2:** FAIL 확인.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** PASS + 스크린샷(②, ③ 일반, ③ 만점) 768/390.
- [ ] **Step 5:** commit `feat: student waiting/restore and paper result with stamp`

### ⏸ 검토 체크포인트 A — 학생 화면
리뷰어: 스펙 §4·§5·§7·§8 대비 코드 + 1440/1024/768/390 스크린샷. 지적사항 수정 후 다음 태스크.

### Task 5: 선생님 껍데기 — 로그인 모달, 상단 줄, 탭

**Files:** Modify: `index.html`(`#passwordModal` 쪽지 모양: `#teacherPwInput`, `#pwError`, 취소/들어가기; `#teacherView`: 상단 `#tExamTitle`, `#tCounts`, `#publishSwitch`(label "학생에게 결과 보여주기" + 켜짐/꺼짐 글자), `#toStudentBtn` "학생 화면"; 탭 `role="tablist"` 버튼 3개 `채점`/`결과 보기`/`정답과 설정` + 패널 `#panelGrade`, `#panelResults`, `#panelSetup`; 학생 화면 오른쪽 위 조용한 "선생님" 버튼), `app-teacher.html`, `dev/selftest.js`

**Interfaces:**
- Consumes: Task 1 공용 함수.
- Produces: `teacherState = { pw, settings, questions, submissions, stats, tab: 'grade'|'results'|'setup', gradeView: 'byQuestion'|'byStudent', selectedQNum: number|null, selectedRowIndex: number|null }`; `openTeacherLogin()`, `confirmTeacherLogin() => Promise<void>` (실패 메시지는 `#pwError`), `refreshTeacherData() => Promise<void>` (`verifyTeacherAndGetData`, 상태 갱신 후 현재 탭만 렌더, 스크롤 유지); `countWaiting(submissions) => number` (`!isCompleted` 수); `renderTopBar()`; `switchTab(name)` (좌우 화살표 키 이동); `togglePublish(checked) => Promise<void>` (`setPublishResultsStatus({authPassword, publish, markAllCompleted:false})`, 토스트 "결과를 보여주기 시작했어요" / "결과를 다시 가렸어요", 실패 시 스위치 되돌림).
- 패널 렌더 함수 이름(이후 태스크가 구현): `renderGradePanel()`, `renderResultsPanel()`, `renderSetupPanel()`.

- [ ] **Step 1:** 테스트 (`scenario=teacher`): 틀린 비번 → `#pwError` 문구, 모달 유지; 맞는 비번(스텁 `1234`) → 선생님 화면, `#tCounts` 텍스트에 `제출 5명`과 `채점 대기 3명`; `countWaiting` 단위 테스트; 탭 클릭 시 해당 패널만 보이고 `aria-selected` 갱신; 첫 탭 = 채점, `gradeView === 'byQuestion'`.
- [ ] **Step 2:** FAIL. **Step 3:** 구현. **Step 4:** PASS + 1024 스크린샷.
- [ ] **Step 5:** commit `feat: teacher shell with paper tabs and publish switch`

### Task 6: 채점 탭 — 문항별(기본)·학생별, 채점 칸, 완료 규칙

**Files:** Modify: `app-teacher.html`, `dev/selftest.js`, (`dev/stub-gas.js` 필요한 시나리오 보강)

**Interfaces:**
- Consumes: Task 5 `teacherState`, `refreshTeacherData`, `renderTopBar`.
- Produces:
  - `countPendingForQuestion(submissions, qNum) => number` (`perQuestionMap[qNum].status === '보류'` 수).
  - `orderQuestionsForGrading(questions, submissions) => number[]` (qNum 순서: 보류가 남은 서술형 → 다른 서술형 → 나머지, 각 그룹 안은 qNum 오름차순). `selectedQNum` 기본값 = 첫 항목.
  - `buildGradePayload(sub, qNum, status, earned, max) => object` = `{authPassword, rowIndex, rowKey, updatedQuestions:{[qNum]:{status, earnedPoints, maxPoints}}, forceComplete: sub.isCompleted}` — **채점 클릭은 완료 상태를 바꾸지 않는다**(스펙 §6, 사용자 결정 1-나).
  - `gradeCell(rowIndex, qNum, status, earned?) => Promise<void>`: 낙관적 표시 → `updateStudentQuestionGrade` → 성공 시 `sub.perQuestionMap[qNum]`, `sub.totalScore = res.newTotalScore`, `sub.isCompleted = res.isCompleted` 갱신하고 해당 행·상단 줄만 다시 그림; 실패 시 이전 표시로 복원 + 오류 토스트. 전체 재렌더 금지.
  - `parsePartialScore(input: string, max: number) => {ok: true, value: number} | {ok: false, message: string}` (빈칸/숫자 아님/음수/초과 → `"0에서 {max}점 사이 숫자를 써주세요"`; 값이 max면 상태 O, 0이면 X, 그 외 △).
  - `finishStudent(rowIndex, mode: 'auto'|'complete'|'commentOnly') => Promise<void>`: `auto`는 보류가 없으면 `forceComplete:true`, 있으면 저장하지 않고 인라인 안내 "아직 안 매긴 서술형이 있어요(4번). 완료하면 0점으로 보여요." + `한 말씀만 저장`(`commentOnly`: `forceComplete` 미전송) / `그래도 완료`(`complete`) 버튼 표시. 저장 성공 후 다음 학생 선택. 토스트: "채점을 끝냈어요" / "한 말씀을 저장했어요".
- 문항별 보기: 머리 `N번 · 유형 · 배점 · 채점 기준`, 서술형 아니면 "자동 채점 문항", `M명 남음`; 표 `학생 | 답 | 채점`; 해당 문항 보류가 0이 되면 안내 한 줄 "학생별로에서 한 말씀을 쓰고 '채점 끝'을 누르면 학생에게 보여요."
- 학생별 보기: 명렬표(번호 | 이름 | 점수 또는 "대기"), 선택 시 `번호 | 학생 답 | 정답 | 채점` 표, 빨간 밑줄 한 말씀 입력(`#commentInput`), `이전 학생` / `채점 끝, 다음 학생`. 900px 미만 1단.
- 채점 칸: `button.mark-cell` ○ △ / + `input.score-input`; △ 누르면 점수 칸 포커스(기본값 `Math.round(max/2)`), Enter/blur 저장, 오류는 `.inline-error`.

- [ ] **Step 1:** 테스트 (`scenario=teacher`): `orderQuestionsForGrading` 첫 항목이 서술형 qNum; `countPendingForQuestion` = 3; 대기 학생의 마지막 보류를 `gradeCell(...,'O')` 하면 스텁 응답 `isCompleted === false`이고 `#tCounts` 대기 수 그대로 3; 완료된 학생을 `/`로 다시 매겨도 `isCompleted` true 유지; `?fail=updateStudentQuestionGrade`에서 클릭 → 칸 `aria-pressed`가 원래대로, 토스트 kind error; `parsePartialScore` 표: `''`,`'-1'`,`'21'`(max 20),`'abc'` → ok false, `'7.5'` → 7.5, `'20'` → 20; 보류 남은 학생 `finishStudent(row,'auto')` → 서버 호출 없음 + 버튼 2개 표시, `commentOnly` payload에 `forceComplete` 키 없음, `complete` payload `forceComplete === true`; 이름 `<b>"민'수"</b>` 학생 행에 `<b>` 요소 없음; 채점 후 `window.scrollY` 변화 없음.
- [ ] **Step 2:** FAIL. **Step 3:** 구현. **Step 4:** PASS + 1440/768 스크린샷(시안 `teacher-view.html` ①② 비교).
- [ ] **Step 5:** commit `feat: grading tab by question and by student`

### Task 7: 결과 보기 탭 + 정답과 설정 탭 + 서버 문구

**Files:** Modify: `app-teacher.html`, `Code.js`(반환 메시지 문구만: 저장 성공 `'저장했어요.'`, 초기화 `'제출 기록을 모두 지웠어요.'`, 채점 `'채점을 저장했어요.'`, 기타 오류 문구에서 이모지·"완벽히" 류 제거), `dev/selftest.js`

**Interfaces:**
- Consumes: Task 5 `teacherState`, `refreshTeacherData`.
- Produces: `renderResultsPanel()` — 오답 표 `번호 | 틀린 학생(잉크 막대 + "N명 (x%)") | 가장 많이 쓴 오답`(서술형 제외, 데이터 없으면 "제출이 쌓이면 문항별로 틀린 학생 수가 나와요."), 제출 명렬표(시간·번호·이름·총점·상태·문항별 요약, `.table-wrap`), `제출 기록 모두 지우기` 인라인 2단계(첫 클릭 → "정말 지울까요? 되돌릴 수 없어요." + `지우기`/`그만두기`). `renderSetupPanel()` — 정답표(번호 | 유형 select | 칸 수(자동) | 정답 | 배점 | 부분점수 | 삭제), 표 위 규칙 두 줄("쉼표(,)로 나누면 빈칸이 늘어나요. 예: 2, 4" / "빗금(/)으로 묶으면 둘 다 정답이에요. 예: 훈민정음/한글"), `문항 추가`, 설정(시험 제목, 선생님 비밀번호, 스위치 4개: "점수와 ○/ 보여주기", "틀린 문제 정답 보여주기", "띄어쓰기 무시하고 채점", "다시 내기 허용"), 버튼 하나 `저장` → `saveTeacherConfig({authPassword, settings:{..., omrTheme:'blue'}, questions})` 후 토스트 "저장했어요", 새 비밀번호 반영. 기존 `origQNum` 처리 유지. 칸 수는 입력 중 재렌더 없이 해당 셀 텍스트만 갱신.
- 테마 칩 UI 없음.

- [ ] **Step 1:** 테스트: 결과 탭 막대 수 = 서술형 아닌 문항 수; 지우기 첫 클릭에 서버 호출 없음, 두 번째에 `clearSubmissionRecords` 호출; 설정 탭 저장 payload `settings.omrTheme === 'blue'`, 새 문항 `origQNum === null`; 정답 입력 `'2, 4'` 입력 시 칸 수 셀 `2칸`, 입력 포커스 유지; DOM에 테마 칩 없음.
- [ ] **Step 2:** FAIL. **Step 3:** 구현. **Step 4:** PASS + 스크린샷.
- [ ] **Step 5:** commit `feat: results and setup tabs; tidy server messages`

### ⏸ 검토 체크포인트 B — 선생님 화면
리뷰어: 스펙 §6·§7·§8 + 1440/1024/768/390 스크린샷. 수정 후 다음.

### Task 8: 마무리 — 문서, 최종 리뷰, 배포 준비

**Files:** Modify: `CLAUDE.md`(아키텍처: include 파일 구조, `dev/preview.mjs` 사용법, 폰트, 테마 UI 제거·`omrTheme` 키 잔존, 완료 규칙 "채점 클릭은 `forceComplete: 현재값`, 완료는 '채점 끝'에서만", 학생 복귀 `localStorage` 키), `Code.js:1-8` 헤더 주석(폭죽 → 도장)

- [ ] **Step 1:** 전체 셀프테스트 모든 시나리오 `fail === 0` 확인.
- [ ] **Step 2:** `grep -nE "alert\(|confirm\(|prompt\(|confetti|Jua|Gowun Dodum|omr-theme|themeBtn_" index.html styles.html app-*.html` → 출력 없음.
- [ ] **Step 3:** `CLAUDE.md` 갱신, commit `docs: update CLAUDE.md for paper redesign`.
- [ ] **Step 4:** 브랜치 전체 `/code-review` (버그 중심: 채점 저장·공개 시점·복귀). 지적 수정·커밋.
- [ ] **Step 5:** `clasp push` 전 사용자 확인 → 사용자가 테스트 배포에서 제출→채점→채점 끝→공개 흐름 수동 확인. (메모리 규칙: "커밋 푸시" = git push + clasp push)
