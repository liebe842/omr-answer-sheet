# AGENTS.md

This file provides guidance to Codex (claude.ai/code) when working with code in this repository.

## Project

"우리들의 답안지" — an OMR-style answer sheet web app for classroom tests, built as a **Google Apps Script web app** bound to a Google Spreadsheet. Students fill in an OMR card and submit; answers are auto-graded server-side; teachers grade essay questions, leave comments, and publish results from a password-protected teacher mode. All UI text, sheet names, and comments are in Korean.

There is no build step, package.json, linter, or test suite. The local files are synced to Apps Script with `clasp` (scriptId in `.clasp.json`, `rootDir` is the repo root).

## Commands

```sh
clasp push            # upload Code.js / appsscript.json / index.html / styles.html / app-*.html (see .claspignore allowlist)
clasp pull            # pull remote edits (overwrites local files)
clasp open            # open the script editor
clasp deploy          # create a new web-app deployment version
clasp run <fnName>    # run a server function remotely (requires API executable setup)
```

### Local preview and self-tests

The client can be exercised without Apps Script, using a stub of `google.script.run`:

```sh
node dev/preview.mjs                                   # build dev/out/preview.html (includes expanded, stub + selftest inlined; no server, open as file://)
node dev/run-selftest.mjs <scenario> [--width=360] [--fail=fn]   # headless Chrome; prints "PASS n / FAIL m" + failures, exit 1 on failures
node dev/screenshot.mjs <scenario> <width> [name] [query]   # PNG to dev/out/shots/; optional extra query, e.g. "demo=teacher&tab=results"
```

Scenarios: `fresh`, `empty`, `teacher`, `perfect`. `--fail=fn` makes that stub server function error. Tests live in `dev/selftest.js` (`test(name, fn, {scenario})`); the stub records calls in `window.__gasCalls`. `dev/chrome.mjs` is the shared headless-Chrome helper (Chrome path via `CHROME_PATH`, fresh profile per run, widths under ~504px rendered through an iframe). `dev/stub-gas.js` mirrors the server's return shapes, so **keep it in sync whenever a server response changes**. The real Apps Script flow (submit, grade, "채점 끝", publish) is still tested manually: `clasp push`, then open the web app deployment URL. `initialSetup_()` runs on every `doGet()`, so opening the web app creates missing sheets; private (`_`) functions do not appear in the editor's Run menu or `clasp run`, so to run one by hand, call it from a temporary public wrapper in the editor.

## Architecture

Server plus a client split into partials:

- **`Code.js`** — server side (V8 runtime). `doGet()` runs `initialSetup_()` and serves `index.html` via `HtmlService.createTemplateFromFile`. `include(name)` returns a partial's raw content. The only other public functions are the 8 RPCs the client calls (`getStudentInitData`, `submitStudentAnswers`, `checkStudentResultStatus`, `verifyTeacherAndGetData`, `updateStudentQuestionGrade`, `setPublishResultsStatus`, `saveTeacherConfig`, `clearSubmissionRecords`). Functions ending in `_` are private: Apps Script does not expose them through `google.script.run`, so anonymous users cannot call them (e.g. `getSettingsMap_()` returns the teacher password). Keep every new helper private that way.
- **Client** — `index.html` (markup for student view / teacher view) pulls in the rest with `<?!= include('name') ?>`: `styles.html` (all CSS, paper/ink tokens), `app-common.html` (shared helpers, toasts, server calls), `app-student.html` (OMR card, submit, result stamp, restore), `app-teacher.html` (grading / results / setup tabs). The client calls the server exclusively through `google.script.run.withSuccessHandler(...).<serverFn>(payload)`. The only external dependency is Google Fonts.
- **`.claspignore`** is an allowlist: only `Code.js`, `appsscript.json`, `index.html`, `styles.html`, `app-*.html` are pushed (`dev/`, `docs/`, `.superpowers/`, `*.md` are not).

### Visual system

Korean elementary 갱지 answer sheet: paper/ink CSS tokens, fonts Gowun Batang (titles, `--font-title`), Nanum Gothic (body/inputs, `--font-body`), Nanum Pen Script (red pen, `--font-pen`). Teacher-side text is at least 13px. The red pen (`--red-pen`) is reserved for teacher marks: ○ △ / marks, scores, correct-answer notes, 한 말씀, and the "참 잘했어요" stamp. There is no `alert`/`confirm`/`prompt`; feedback uses toasts and inline messages. `canvas-confetti` was removed. The theme picker UI is gone, but the `omrTheme` key stays in `환경설정` for compatibility and the client always saves `'blue'`.

When renaming or changing the signature of a server function, update the matching `google.script.run` call in the client partials and `dev/stub-gas.js`.

### The spreadsheet is the database

`initialSetup_()` creates three sheets (if missing) in the active spreadsheet; code references them by these exact Korean names:

1. **`환경설정`** (settings) — key/value rows: `examTitle`, `teacherPassword`, `showScore`, `showCorrectAnswers`, `ignoreSpaces`, `allowResubmit`, `omrTheme`, `publishResults`. Read via `getSettingsMap_()`, which coerces `"TRUE"/"FALSE"` strings to booleans. New keys must be added in three places: defaults in `getSettingsMap_()`, the sheet init/migration in `initialSetup_()` (which `appendRow`s missing keys on existing sheets), and the full rewrite in `saveTeacherConfig()`.
2. **`정답설정`** (answer key) — columns A–F: question #, type, blank count (auto formula), answer string, points, partial-credit checkbox. `applySheetFormattingAndFormulas_()` re-applies the header, type dropdown (B), blank-count formula (C), text format (D), and checkbox (F) for 50 rows; it must be called after any rewrite of this sheet.
3. **`제출결과`** (submissions) — fixed columns by index: `[0]` timestamp, `[1]` student #, `[2]` name, `[3]` total, `[4]` summary text, `[5]` graded-complete `TRUE/FALSE`, `[6]` teacher comment, `[7]` per-question JSON `{qNum: {status, earnedPoints, maxPoints}}`, `[8+]` one answer column per question. The header row is rewritten on every submission to match current questions. Teacher grading addresses rows by 1-based sheet `rowIndex` plus a `rowKey` (`getSubmissionRowKey_`: timestamp|number|name); `updateStudentQuestionGrade` rejects the write if the row no longer matches the key. When `saveTeacherConfig` changes the question list, `remapSubmissionsToQuestions_` rewrites columns D onward (using each question's `origQNum` from the client) so answers and JSON keys follow their questions.

Rows in `정답설정` are skipped when A, B, and D are all empty — this same skip rule is repeated in several functions, and answer columns `[8+]` in `제출결과` are matched to questions by position (`colOffset`), so they must stay consistent.

### Answer-string syntax and grading

`parseAnswerSlots_()` parses column D: **`,` separates blanks** (legacy `|` also accepted) and **`/` separates accepted synonyms** within a blank, e.g. `세종대왕/세종, 장영실` → `[['세종대왕','세종'],['장영실']]`. 서술형 (essay) is always a single slot.

`normalizeQuestionType_()` maps free-text types onto six canonical types: `객관식`, `기호(ㄱ,ㄴ,ㄷ)`, `기호(가,나,다)`, `OX퀴즈`, `단답식`, `서술형`. The client (`getBubbleOptionsForType`) renders bubbles based on these exact strings.

`evaluateSingleQuestion_()` grading rules:
- Normalization: trim, optional whitespace removal (`ignoreSpaces`), circled-character mapping (①→1, ㉠→ㄱ, ○→o …), lowercase.
- Choice types with multiple blanks: order-independent matching; partial credit only if no wrong picks.
- 단답식 with multiple blanks: positional matching per blank; partial credit = proportional, rounded to 0.1.
- 서술형: status `보류` (pending), 0 points, until the teacher grades it. Status values are `O`, `X`, `△`, `보류`.

### Result-publishing flow

On submit, a row is marked complete only if there are no essay questions. Students then poll `checkStudentResultStatus()`, which returns `{published: false}` until **both** `publishResults` is TRUE and that student's row is complete. `updateStudentQuestionGrade()` recomputes total/summary from the JSON column and sets completion from `forceComplete`; only when `forceComplete` is omitted does it fall back to marking the row complete once no `보류` remains (the client always sends it, see below). Saving 정답과 설정 never changes completion: `remapSubmissionsToQuestions_` keeps each row's previous value (R17). `setPublishResultsStatus()` can optionally force all rows complete.

Client completion rule: grading-cell saves send `forceComplete: <row's current isCompleted>` and never `teacherComment`; only "채점 끝" completes (`forceComplete: true`, with the comment). "한 말씀만 저장" sends the row's current `isCompleted` (R11). So the server's `!hasPending` auto-complete fallback is never used by the client.

Student restore: after a submit the client keeps the pending submission in `localStorage` key `omr.pendingSubmission.v1` (12h TTL, must match the current `examTitle`) so a reload returns to the waiting/result screen. The result screen uses those saved per-blank answers only when they reproduce the server's `userAnswer` string (trimmed blanks joined by `, `, or `(미입력)`); otherwise (questions deleted/reordered) it splits the server string.

Teacher view data refreshes on login, on the top-bar "새로고침" button, and on every tab switch (`refreshTeacherData`, session-guarded, keeps scroll and a dirty setup draft). Setup save waits for an in-flight publish toggle and vice versa; after a setup save, returning to the student view reloads a sheet that is still being written.

### Auth and concurrency

Teacher authentication is a plain password compare against `teacherPassword` in the settings sheet. The client re-asks for the password on every entry to teacher mode and keeps it only in memory; saving settings with an empty password field keeps the current password.

Each teacher RPC receives the password (`authPassword` or `passwordInput`) and re-checks it. The web app runs as the deploying user with anonymous access (`appsscript.json`). Write endpoints (`submitStudentAnswers`, `updateStudentQuestionGrade`, `saveTeacherConfig`) use `LockService.getScriptLock()`.
