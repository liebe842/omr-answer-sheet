# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

"우리들의 답안지" — an OMR-style answer sheet web app for classroom tests, built as a **Google Apps Script web app** bound to a Google Spreadsheet. Students fill in an OMR card and submit; answers are auto-graded server-side; teachers grade essay questions, leave comments, and publish results from a password-protected teacher mode. All UI text, sheet names, and comments are in Korean.

There is no build step, package.json, linter, or test suite. The local files are synced to Apps Script with `clasp` (scriptId in `.clasp.json`, `rootDir` is the repo root).

## Commands

```sh
clasp push            # upload Code.js / index.html / appsscript.json to Apps Script
clasp pull            # pull remote edits (overwrites local files)
clasp open            # open the script editor
clasp deploy          # create a new web-app deployment version
clasp run <fnName>    # run a server function remotely (requires API executable setup)
```

Testing is manual: push, then open the web app deployment URL (or the test deployment from the editor). Functions like `initialSetup()` can also be run from the Apps Script editor.

## Architecture

Two source files:

- **`Code.js`** — server side (V8 runtime). `doGet()` runs `initialSetup()` and serves `index.html` via `HtmlService.createTemplateFromFile`. All other top-level functions are RPC endpoints called from the client.
- **`index.html`** — the entire client: CSS, markup for student view / teacher view / password modal, and an inline `<script>` that calls the server exclusively through `google.script.run.withSuccessHandler(...).<serverFn>(payload)`. External deps: Google Fonts (Gowun Dodum, Jua) and `canvas-confetti` from jsDelivr (perfect-score effect).

When renaming or changing the signature of a server function, update the matching `google.script.run` call in `index.html`.

### The spreadsheet is the database

`initialSetup()` creates three sheets (if missing) in the active spreadsheet; code references them by these exact Korean names:

1. **`환경설정`** (settings) — key/value rows: `examTitle`, `teacherPassword`, `showScore`, `showCorrectAnswers`, `ignoreSpaces`, `allowResubmit`, `omrTheme`, `publishResults`. Read via `getSettingsMap()`, which coerces `"TRUE"/"FALSE"` strings to booleans. New keys must be added in three places: defaults in `getSettingsMap()`, the sheet init/migration in `initialSetup()` (which `appendRow`s missing keys on existing sheets), and the full rewrite in `saveTeacherConfig()`.
2. **`정답설정`** (answer key) — columns A–F: question #, type, blank count (auto formula), answer string, points, partial-credit checkbox. `applySheetFormattingAndFormulas()` re-applies the header, type dropdown (B), blank-count formula (C), text format (D), and checkbox (F) for 50 rows; it must be called after any rewrite of this sheet.
3. **`제출결과`** (submissions) — fixed columns by index: `[0]` timestamp, `[1]` student #, `[2]` name, `[3]` total, `[4]` summary text, `[5]` graded-complete `TRUE/FALSE`, `[6]` teacher comment, `[7]` per-question JSON `{qNum: {status, earnedPoints, maxPoints}}`, `[8+]` one answer column per question. The header row is rewritten on every submission to match current questions. Teacher grading addresses rows by 1-based sheet `rowIndex` plus a `rowKey` (`getSubmissionRowKey`: timestamp|number|name); `updateStudentQuestionGrade` rejects the write if the row no longer matches the key. When `saveTeacherConfig` changes the question list, `remapSubmissionsToQuestions` rewrites columns D onward (using each question's `origQNum` from the client) so answers and JSON keys follow their questions.

Rows in `정답설정` are skipped when A, B, and D are all empty — this same skip rule is repeated in several functions, and answer columns `[8+]` in `제출결과` are matched to questions by position (`colOffset`), so they must stay consistent.

### Answer-string syntax and grading

`parseAnswerSlots()` parses column D: **`,` separates blanks** (legacy `|` also accepted) and **`/` separates accepted synonyms** within a blank, e.g. `세종대왕/세종, 장영실` → `[['세종대왕','세종'],['장영실']]`. 서술형 (essay) is always a single slot.

`normalizeQuestionType()` maps free-text types onto six canonical types: `객관식`, `기호(ㄱ,ㄴ,ㄷ)`, `기호(가,나,다)`, `OX퀴즈`, `단답식`, `서술형`. The client (`getBubbleOptionsForType`) renders bubbles based on these exact strings.

`evaluateSingleQuestion()` grading rules:
- Normalization: trim, optional whitespace removal (`ignoreSpaces`), circled-character mapping (①→1, ㉠→ㄱ, ○→o …), lowercase.
- Choice types with multiple blanks: order-independent matching; partial credit only if no wrong picks.
- 단답식 with multiple blanks: positional matching per blank; partial credit = proportional, rounded to 0.1.
- 서술형: status `보류` (pending), 0 points, until the teacher grades it. Status values are `O`, `X`, `△`, `보류`.

### Result-publishing flow

On submit, a row is marked complete only if there are no essay questions. Students then poll `checkStudentResultStatus()`, which returns `{published: false}` until **both** `publishResults` is TRUE and that student's row is complete. `updateStudentQuestionGrade()` recomputes total/summary from the JSON column and marks the row complete once no `보류` remains. `setPublishResultsStatus()` can optionally force all rows complete.

### Auth and concurrency

Teacher authentication is a plain password compare against `teacherPassword` in the settings sheet; each teacher RPC receives the password (`authPassword` or `passwordInput`) and re-checks it. The web app runs as the deploying user with anonymous access (`appsscript.json`). Write endpoints (`submitStudentAnswers`, `updateStudentQuestionGrade`, `saveTeacherConfig`) use `LockService.getScriptLock()`.
