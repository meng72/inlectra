# InLectra architecture

## Local session creation

GitHub Pages can serve the Vite build as static assets. The browser delegates identity to Firebase Auth. A verified Google sign-in can use any email domain. The React auth provider reads the ID token and selects the student or instructor view. The UI never grants a role.

The instructor form sends a title and operation UUID to the `createSession` HTTPS callable. Firebase validates the attached ID token. The function checks the verified email, Google sign-in provider, and boolean instructor claim. A strict input schema rejects extra fields. The backend supplies ownership and the creation time.

The function reserves a random code under `/createOperations/{uid}/{operationId}`, then conditionally creates `/sessions/{id}`. A replay resumes the reservation, validates the title, and initializes any missing admission record. A code collision moves the reservation to another random code. Both steps use transactions at their respective keys. The browser keeps the operation ID in per-account tab storage until it receives a receipt.

| Record field     | Source                                             |
| ---------------- | -------------------------------------------------- |
| `id`, `joinCode` | Same cryptographically random code                 |
| `instructorUid`  | Authenticated caller UID                           |
| `title`          | Trimmed instructor input, 1 to 120 characters      |
| `createdAt`      | Function clock, Unix milliseconds                  |
| `joinExpiresAt`  | Eight hours after creation                         |
| `operationId`    | Original creation request                          |
| `state`          | Starts as `open` and becomes `archived` on archive |

The response carries the ID, code, and title. The owner can reopen a session by code. The latest managed code survives reload in the same tab.

## Admission and archive

The QR code and plain link target the current page with `?join={code}`. Signing in preserves the query. The student explicitly submits the code. The callable normalizes lowercase and surrounding spaces and takes the UID and verified email from the token.

A transaction at `/admissions/{id}` checks the session gate and creates `members/{uid}` with the verified email and original join time. This transaction serializes admission with archive for the same lecture. Existing members keep their receipt after expiry. A milestone 1 session initializes its gate on first join, using its original creation time.

Archive checks the immutable owner and atomically updates both state fields and removes `/admissions/{id}/live`. The archive marker prevents delayed joins, create retries, and new question commands from reopening a lecture. Private memberships remain available for future reporting.

## Question plans

The browser parses CSV and verifies its header for preview. The import callable independently validates the rows using the shared question schema. An instructor can also construct one question in the browser and send the same canonical question shape to `createQuestion`. The server stores canonical questions at `/questionBanks/{courseId}/{questionId}`. Transactions at `/questionBanks/{courseId}` store retry receipts for imports and direct creation. Each operation verifies that the authenticated instructor owns `/courses/{uid}/{courseId}`. A replay with the same normalized content returns the original question IDs. A replay with different content fails. Replaying an import after a bank deletion preserves the deletion.

The create, import, and update transactions write server-controlled modification metadata. The instructor client sorts valid questions by that timestamp in descending order and places records without metadata last. The `updateQuestion` callable validates the complete replacement question and performs one transaction at `/questionBanks/{courseId}`. Bank-level revision metadata rejects stale editors, while an operation receipt makes a transport retry return the original result. The editor keeps the question type fixed and can replace the prompt, grading flag, choices, and answer key. Existing lecture plans remain unchanged because every queue item owns the question snapshot captured when it was added; later additions use the latest bank revision.

## Course workspaces

`createCourse` requires an instructor claim, course number, semester, and operation ID. It stores a retry receipt under `/createCourseOperations/{uid}/{operationId}` and the owned workspace under `/courses/{uid}/{courseId}`. Lecture creation requires an owned course ID and stores the course ID, course number, and semester immutably on the session. The student-readable live projection copies the course number and semester from that trusted session so both workspaces show the same context without exposing the private course record. Adding a bank question derives the bank ID from the trusted session, so a client cannot move a question across course or semester boundaries by changing a request field.

The instructor UI owns one course selector in lecture setup. `QuestionWorkspace` receives the parsed selected course and uses its branded ID for every bank operation. The bank and CSV importer repeat the course number and semester as read-only orientation text; they do not maintain a second selection state that could disagree with the destination ID.

The lecture plan at `/admissions/{id}/control` contains an ordered array of question snapshots, their states, and a revision. Each command includes its expected revision and an operation ID. If two commands use the same revision, only the first distinct command to commit can apply. A replay returns the original receipt, even after later commands or archive.

A transaction at `/admissions/{id}` updates the plan and the live projection together. The question list contains each available question's ID, type, prompt, grading flag, and options. A map keyed by question ID carries explicitly revealed statistics flags and configured answer keys. The transaction also records the command receipt.

## Data access

The database rejects client writes. A verified Google instructor can read their question bank, an owned session by ID, and that session's control plan. A verified Google member can read the open lecture's `/admissions/{id}/live` view. The admission parent, membership rows, email addresses, plan receipts, and creation reservations are backend-only. The Admin SDK bypasses rules, so each function enforces its own authorization.

Reading a parent in Realtime Database grants access to its descendants. Keep all private records outside the live view. Unrevealed answer keys stay in the question bank and private lecture plan.

The student client clears the title when its live subscription loses access or the view disappears. Archive blocks subsequent server reads. A disconnected client can retain previously delivered data until reconnect.

## Answer submission and statistics

The `submitAnswer` callable accepts a lecture ID, question ID, answer, operation ID, and expected revision. It derives the UID and verified email from Firebase Auth and the grading flag from the question snapshot. Revision zero identifies the first submission. An accepted revision increments the number by one. Reusing an operation ID with the same normalized request returns its original receipt. Reusing it with different input fails.

The admission transaction checks lecture state, membership, and question availability before it commits. It updates `/admissions/{id}/questionActivity/{questionId}` with the latest answer, its immutable participation point, the operation receipt, and fresh aggregate counts. Answer commits, archive, and question changes share the lecture transaction boundary. Other lectures have independent transactions.

An open-lecture member can read only their own `responses/{uid}/accepted` record. The response parent, private email, operation history, and other students' answers are backend-only. The owner can read each question's `publicStats` aggregate, including after archive. Students can read it only when the statistics flag is present in the open lecture's live reveal map. A previously delivered reveal cannot be recalled from a browser. Closing a lecture prevents new student reads and writes.

Test simultaneous submissions across a synthetic class of 60 to 80 before a pilot. A burst of writes can contend on the lecture transaction even when students answer different questions. Agree on retention for submissions and retry receipts.

## Student question inbox

The `mutateStudentQuestion` callable derives the author UID, verified email, and available display name from the authenticated token. It accepts create, revise, and withdraw commands with operation IDs. A create assigns a server-generated UUID. Revisions and withdrawals require the current record revision and are available only while a question remains open and private. The lecture admission transaction checks membership and archive, stores the private record under `/admissions/{id}/studentQuestions/{uid}/{questionId}`, and records a retry receipt outside the student-readable record.

The owner-authorized `reviewStudentQuestion` callable accepts publish, answer, and dismiss commands. The same admission transaction updates the private record and `/admissions/{id}/live/studentQuestions` together. The live projection contains only the question ID, text, publication time, and answered status. It never contains the author UID, email, or display name. Dismissal removes an existing public projection.

Rules allow an open-lecture member to read only their own student-question branch. The lecture owner can read the complete private inbox. No browser can write directly or read operation receipts. Archive removes the entire live projection and ends student reads and mutations; private records remain inside the lecture deletion boundary. The inbox hides author identity by default as display logic, while backend authorization remains unchanged.

## Instructor workspace shell

`InstructorDesk` owns the selected course, course-level view, and opened lecture. At the course level it switches among Lectures, Question bank, and Archives without stacking them. `QuestionWorkspace` renders the standalone course bank and remains mounted beside an open lecture when the instructor uses live control, bank, or reports. The same component and course ID therefore power full bank management and live imports without copying state into a second implementation.

The backend maintains an owner-readable discovery projection at `/courseLectures/{uid}/{courseId}/{sessionId}`. It contains only immutable lecture context, lifecycle state, and creation time. Session creation adds the summary, archive changes its state in the same root update as the session and admission gate, and permanent deletion removes it with the rest of the lecture. Rules allow only the verified instructor at `$uid` to read the index and deny all client writes. Private lecture contents remain in their existing owner-authorized roots.

`OwnerLecture` renders the persistent session command bar and owns the native student-question and end-class dialogs. Native dialogs provide focus entry, focus containment, Escape handling, and focus return. The inbox remains a secondary task rather than a fourth primary workspace destination. No database shape or authorization boundary changes with workspace navigation.

## Student workspace shell

`LiveLecture` owns one discriminated student workspace state with activities, whiteboard, and class Q&A variants. All three panels stay mounted and use the HTML `hidden` state for presentation. This preserves answer drafts, private question edits, IndexedDB draft state, and live subscriptions while the student changes views. The tab list supports pointer, Tab, Arrow, Home, and End navigation.

`StudentQuestionDesk` limits rendered personal and public records independently. The server already orders personal records by trusted update time and inserts new public records first, so the browser can expose the first five and reveal later pages without changing the data model or privacy boundary. “Whiteboard” is presentation language only; the trusted broadcast record and callable names remain unchanged.

## Live broadcast and private code

The `mutateBroadcast` callable checks the instructor claim and session ownership. The `/admissions/{id}/broadcastControl` record holds the current revision, current document, and operation receipts. Each command supplies the revision it expects. A retry with the same normalized command returns its original receipt. A competing command against an old revision fails.

The admission transaction projects the public document to `/admissions/{id}/live/broadcast` and shares its boundary with archive. Clear removes the public document and advances the revision. The public document contains its format, content, selected lines, revision, and language for code. The browser renders the document as escaped text and syntax tokens.

The private draft uses a compound IndexedDB key containing the Firebase UID and lecture ID. The stored value records content, its source broadcast revision, and the last edit time. The IndexedDB adapter has no Firebase dependency. A failing storage write leaves the on-screen draft available and shows an error. Draft storage is browser-local, including on a shared profile.

The `submitCode` callable checks the admission state, UID, membership, and code broadcast revision in the same transaction that accepts the upload. The latest accepted upload, verified email, and retry receipts live at `/admissions/{id}/codeSubmissions/{uid}`. Only the member's own `accepted` child is readable in the open lecture. The parent, email, peer records, and prior receipts are backend-only. Archive prevents new uploads and ends student read access. A retry can still recover its original metadata-only receipt.

## Cleanup and deletion

Signing out first removes every IndexedDB code draft scoped to the current UID. If browser storage cleanup fails, sign-out stops and reports the failure instead of silently leaving a shared-device draft behind.

The `deleteLectureData` callable requires a verified Google instructor, immutable lecture ownership, archived state, and an exact session-code confirmation. A single root update removes `/sessions/{id}`, `/admissions/{id}`, `/reporting/{id}`, the course-lecture index entry, and the matching creation receipt. Question-bank source material is deliberately outside the lecture deletion boundary. See [the data governance reference](data-governance.md) for the full inventory and production policy boundary.

## Participation reports and roster mapping

The lecture remains the Version 1 roster and reporting scope. A course workspace groups lectures and their reusable question bank; roster imports and participation exports remain lecture-specific until a course-roster workflow is designed.

The `importRoster` callable accepts the exact roster CSV rows, checks lecture ownership, and repeats validation performed in the browser. A transaction at `/reporting/{id}/roster` replaces the full normalized roster. The record contains its revision and operation receipts. Repeating the same operation returns the first receipt. A different operation against an old revision fails.

The reporting UI performs no automatic status read. Clicking **Refresh current status** calls `getReportingSummary`, which owner-authorizes the request and reads the admission and roster records once. It returns counts for joined UIDs, UIDs with at least one accepted answer, awarded participation points, roster entries, and a server snapshot time. It returns no student identities or answers. Report downloads remain separate calls and read fresh server data when requested.

Database rules grant no client access to `/reporting`. The `getReportingSummary` and `createReport` callables check the verified Google provider, verified email, instructor claim, and immutable session owner before reading private data. Reports remain available after archive because archive ends student access, not instructor record access.

`createReport` derives credits from the accepted response under each Firebase UID. The participation CSV includes every joined account. The Canvas CSV joins accounts to roster records by trimmed, lowercase email. It omits unmatched accounts and every account that shares an email with another Firebase UID. The response returns those accounts to the owner for review.

The server quotes every CSV cell. It prefixes values that spreadsheet programs could treat as formulas. The browser downloads the returned text without storing it in Realtime Database.

Answer submissions still use the admission transaction because the transaction serializes the submission window with question state and archive. Exploratory same-millisecond emulator stress exhausted the database client's transaction retry ceiling for both admissions and answers. Those trusted operations now use jittered exponential backoff for up to five attempts, and only repeat a transaction that ended with `maxretry`. Existing join records, operation receipts, and immutable participation points make that repeat safe. The release load check uses 80 students in bounded concurrent waves because a single-process emulator disconnect is not evidence about hosted Firebase capacity.

## Local services

All client Firebase operations in this milestone connect to loopback. Emulator startup uses the demo project ID. The local database namespace is `demo-inlectra-default-rtdb`. Functions and rules tests target that same namespace.

| Component                                            | Implementation                                                                                        |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Sign-in, token changes, callable client              | `src/firebase.ts`                                                                                     |
| Auth provider and lecture form                       | `src/App.tsx`                                                                                         |
| Join form, live view, QR and archive controls        | `src/Lecture.tsx`                                                                                     |
| Request authorization and input schema               | `functions/src/session.ts`                                                                            |
| Session callables and archive                        | `functions/src/index.ts`                                                                              |
| Question callables and persistence                   | `functions/src/question-functions.ts`                                                                 |
| Question schemas and state transitions               | `functions/src/questions.ts`, `functions/src/question-plan.ts`                                        |
| Question bank, lecture queue, and student navigation | `src/QuestionWorkspace.tsx`, `src/QuestionNavigator.tsx`                                              |
| Answer validation, revisions, credit, and statistics | `functions/src/answers.ts`, `functions/src/answer-submission.ts`, `functions/src/answer-functions.ts` |
| Student answer form and aggregate display            | `src/StudentAnswer.tsx`, `src/QuestionStats.tsx`                                                      |
| Broadcast and code submission                        | `functions/src/broadcast-functions.ts`, `functions/src/broadcast-transitions.ts`                      |
| Broadcast editors and local drafts                   | `src/InstructorBroadcast.tsx`, `src/StudentBroadcast.tsx`, `src/codeDraftStore.ts`                    |
| Roster validation and report generation              | `functions/src/reporting.ts`, `functions/src/report-functions.ts`                                     |
| Instructor report workflow                           | `src/ParticipationReports.tsx`                                                                        |
| Student question schemas, transitions, and callables | `functions/src/student-questions.ts`, `functions/src/student-question-transitions.ts`, `functions/src/student-question-functions.ts` |
| Student question and instructor inbox interfaces     | `src/StudentQuestionDesk.tsx`, `src/InstructorQuestionInbox.tsx`                                      |
| Instructor workspace shell and primary navigation    | `src/App.tsx`, `src/Lecture.tsx`                                                                      |
| Student workspace shell and primary navigation       | `src/Lecture.tsx`, `src/StudentQuestionDesk.tsx`, `src/StudentBroadcast.tsx`                          |
| Local-only browser authentication helper             | `src/testAuth.ts` (development host and build-mode guarded)                                           |
| Pilot browser workflow                               | `tests/e2e/pilot-flow.spec.ts`                                                                        |
| Repeatable class-size load check                     | `tests/load.test.mjs`                                                                                 |
| Shared callable response                             | `functions/src/contract.ts`                                                                           |
| Client access policy                                 | `database.rules.json`                                                                                 |

See the Firebase documentation for [callable authentication](https://firebase.google.com/docs/functions/callable), [custom claims](https://firebase.google.com/docs/auth/admin/custom-claims), and [demo project behavior](https://firebase.google.com/docs/emulator-suite/connect_functions).
