# InLectra requirements

## Working assumptions for identity and lecture access

- Any verified email on a Google-authenticated Firebase account is eligible, regardless of domain. The service uses the UID for ownership. It collects no student IDs.
- A trusted administrator grants the boolean `instructor` claim. The local demo grants it to an explicitly selected emulator UID. Production provisioning, revocation, and course-specific delegation need an owner.
- The Auth emulator supplies a simulated Google sign-in popup. Use fictional accounts there. A production OAuth smoke test requires explicit approval.
- Each lecture starts open with one instructor. The instructor supplies a title. The backend assigns the time and a random session code. A conditional write retries a collision without replacing an existing session.
- Students scan a QR link or enter the 12-character code. Instructors can open the QR code in a presentation-focused browser tab for screen sharing. Both paths require a verified Google sign-in and an explicit join. A code admits new members for eight hours from creation. Existing members can rejoin an open lecture after expiry.
- A repeated join preserves the original join time, verified email, and available Google display name. Only the instructor who created the lecture can archive it. Archive is final and blocks new joins and student reads immediately on the server.
- An instructor creates or selects a course workspace before creating a lecture. Both course number and semester are required. A lecture belongs to exactly one workspace, and its bank is reusable only by lectures in that same course and semester.
- A creation request has a per-instructor operation ID. Repeating it with the same trimmed title returns the same lecture. A different title requires a new operation ID.
- Archival must end student access to all lecture views. The retention period for private answers, reports, and instructor archives remains open.
- GitHub Pages will serve the Vite build under a repository subpath. Assets use relative URLs. The demo connects to loopback emulators. Production project, region, domain, and release approval remain open.

## Product acceptance criteria

| Area          | Required behavior                                                                                                                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity      | Students use verified Google accounts. Private participation reports use verified email. No student ID field exists.                                                                                                            |
| Sessions      | Instructors create lectures and share a QR link. Students join an active lecture and cannot browse archived content.                                                                                                            |
| Question bank | Instructors import CSV, maintain the bank, reorder or shuffle questions, publish or hide the entire lecture queue, and publish, hide, skip, or restore individual questions. Students can switch among all available questions. |
| Answers       | Single-choice, multiple-response, numeric, and essay questions accept revisions. Instructors decide when to reveal statistics or correct answers.                                                                               |
| Credit        | Each student earns one point for each submitted graded question, regardless of correctness. Retries and revisions preserve that point.                                                                                          |
| Student voice | Students can privately ask the instructor questions. The instructor can review, answer, dismiss, or publish an anonymous copy to the live class.                                                                          |
| Broadcast     | Instructors broadcast text or code with syntax highlighting and selected lines. Students can optionally edit a private copy.                                                                                                    |
| Drafts        | Store private code in IndexedDB. Send code only when the student explicitly submits it.                                                                                                                                         |
| Reports       | Instructors export participation CSV and roster-matched Canvas CSV. Unmatched or ambiguous accounts require review.                                                                                                             |
| Privacy       | Backend authorization and database rules protect submissions, emails, answer keys, and grades. Browser controls alone do not authorize access.                                                                                  |

## Question bank and publication

Use this exact UTF-8 CSV header and column order.

```csv
Type,Title,Points,Question,Answer,Choice1,Choice2,Choice3,Choice4,Choice5
```

Each file contains 1 to 100 data records. The preview accepts files up to 1 MB. Fields are trimmed. A record with an invalid field or malformed CSV syntax blocks the entire import. Quoted fields can contain commas, line breaks, or doubled double quotes.

- Use `MC`, `MR`, `TF`, `NUM`, or `ESSAY` in `Type`.
- `Title` is optional import metadata. InLectra does not store it.
- Use a nonnegative number in `Points`. A positive value makes the participation question graded. Zero makes it ungraded. The point value does not change the one-point participation rule.
- Use 1 to 2,000 characters in `Question`. Each choice has at most 200 characters. `Answer` has at most 500 characters.
- `MC` requires contiguous choices starting with `Choice1` and `Choice2`. Use the 1-based choice number in `Answer`.
- `MR` uses the same choice columns. Concatenate the correct 1-based choice numbers in `Answer`. For example, `245` marks choices 2, 4, and 5 as correct.
- `TF` requires `TRUE` in `Choice1` and `FALSE` in `Choice2`. Use `1` for true or `0` for false in `Answer`.
- `NUM` and `ESSAY` require blank choice fields. `NUM` requires a numeric `Answer` and preserves it as the answer key. The `ESSAY` placeholder `____` becomes a blank answer key.

An instructor can create a question directly in the application or import questions from CSV. They can list, edit, or delete entries in the selected course-and-semester bank. Editing can change the prompt, grading status, choices, and answer key, but not the question type. A revision check prevents one browser tab from silently overwriting an edit from another tab. The bank is ordered by trusted modification time, newest first; creation, import, and an accepted edit update that time. Records without modification metadata appear last. When a question enters a lecture queue, the queue keeps its own copy. Later bank edits and deletion leave the lecture copy unchanged. Move and shuffle operations keep each question's state.

The question bank shows 10 questions initially. Instructors can search question text, filter by question type, reveal 10 more results at a time, or return to the first 10. Filtering does not change the bank or lecture queue.

The bank header and CSV importer show the selected course number and semester. The importer uses the single course selector from lecture setup instead of introducing a second independent selector. Before lecture creation, **Change course** returns focus to that selector. During a live or archived lecture, the session course is fixed.

**Publish all** makes every queued, hidden, or skipped question available in one revision. **Hide all** makes every currently available question hidden in one revision and leaves queued or skipped questions unchanged. Both operations clear statistics and correct-answer reveals for every question whose state changes.

| Action       | Valid starting state              | New state |
| ------------ | --------------------------------- | --------- |
| Add to queue | Question is absent from the queue | Queued    |
| Publish      | Queued, hidden, or skipped        | Available |
| Hide         | Available                         | Hidden    |
| Skip         | Queued, available, or hidden      | Skipped   |
| Restore      | Hidden or skipped                 | Queued    |

Students can navigate all available questions in lecture order. If the selected question disappears, the selector moves to the question at the same position when possible, or to the last remaining question. Archive ends access to the entire live view.

## Answers, participation, and reveals

Students who joined the lecture can submit or revise an answer while the lecture is open and the question is available. `MC` and `TF` answers select one option. `MR` answers select one or more options. `NUM` and `ESSAY` answers require 1 to 2,000 characters after trimming surrounding whitespace.

The first accepted answer earns one point for a graded lecture question or zero points for an ungraded question. The lecture snapshot fixes grading status. Correctness, revisions, and retries do not change the earned point. Simultaneous revisions from the same accepted answer allow one change to commit. The other must reload and submit against the new revision. A retry of an accepted operation returns its original receipt.

The lecture owner sees aggregate counts. `MC`, `MR`, and `TF` statistics show the latest selection counts per option and the total number of respondents. `NUM` and `ESSAY` statistics show only the total. The owner can reveal statistics and a configured correct answer independently while the question is available. Hiding, skipping, or restoring a question clears both reveals. Republishing starts with both reveals off.

Students can read their own latest accepted answer while the lecture is open. Statistics are visible to them only while the question's statistics reveal is on. Archive ends student access. The lecture owner can still read aggregate counts after archive. Student email, operation receipts, and answers from other accounts remain private.

## Student question inbox

An authenticated lecture member can submit up to 20 questions during an open lecture. Each question contains 1 to 500 characters after trimming. Student questions do not award participation credit and remain separate from the instructor question bank and graded lecture queue.

The student can read their own submissions. They can revise or withdraw a question only while it is open, private, and has not been reviewed or published. Revision checks prevent one browser tab from overwriting a newer change. Retries with the same operation ID preserve the original receipt. Archive blocks new submissions, revisions, withdrawals, and student reads.

The lecture owner receives a real-time private inbox ordered by the latest update. The inbox defaults to hiding student identities; the instructor can reveal the available Google display name or verified email in their private view. The instructor can publish an anonymous copy, mark a question answered, or dismiss it. Publication never copies the UID, email, or display name into the student-readable live projection. Marking a published question answered updates its public status. Dismissing it removes the public copy. Students cannot read peers' private submissions or any operation receipts.

## Instructor workspace

For the selected course and semester, the instructor sees separate **Lectures**, **Question bank**, and **Archives** views. Lectures contains session creation and currently open lectures. Question bank provides full reusable-question management without stacking it below lecture setup. Archives lists completed lectures newest first and opens their owner-only detail. Students cannot read the index or archived lecture data.

After a lecture starts, the course workspace gives way to one focused session command bar. The bar keeps the course number, semester, lecture title, state, session code, QR presentation, join link, open student-question count, course-home action, and end-class action reachable without returning to the top of a long page. Ending a class requires confirmation.

The open lecture workspace has three primary views: **Live control** for broadcasts and the lecture queue, **Question bank** for importing, creating, editing, and adding questions during class, and **Reports** for on-demand status and exports. The live Question bank and full course Question bank use the same course-scoped records and controls. Switching views preserves in-progress bank filters and editor state. The student-question inbox opens as a secondary drawer from every primary view. On small screens, controls wrap without causing page-level horizontal scrolling.

## Student workspace

After joining, a student sees the course number, semester, and lecture title above three primary views: **Activities** for available participation questions, **Whiteboard** for instructor-provided text, code, highlights, and private code drafts, and **Class Q&A** for private question submission and anonymous questions shared with the class. Student-facing language uses “whiteboard” instead of the implementation term “broadcast.” Switching views preserves unfinished answers, question edits, and private code drafts.

The Class Q&A view separates the student's private submissions from the anonymous class feed. Both lists show the five most recent records initially and provide explicit controls to reveal additional records or collapse the list again. The student workspace must not introduce page-level horizontal scrolling at phone portrait or landscape widths.

## Live broadcast and private code

The owner of an open lecture can publish, update, or clear one broadcast. Published text and code contain 1 to 50,000 characters. Instructors can select one or more line numbers to highlight. Highlighted lines count from one. The server rejects lines outside the document. Code supports plain text, JavaScript, TypeScript, Python, Java, C, C++, JSON, HTML, CSS, and Bash.

A student can start a private copy of a code broadcast. IndexedDB stores one draft per browser origin, account, and lecture. A later broadcast leaves the draft intact. Students can edit, reset, or discard the copy. Pressing Tab in an instructor code broadcast or a student's private code draft inserts a tab character instead of moving focus. Code editors and previews render each tab at a four-space tab stop without replacing the stored tab character. Closing a lecture blocks access to its browser editor. Drafts remain on the device until discarded or the browser clears site data. Use **Discard private draft** before signing out of a shared device.

The **Submit private code** action uploads 1 to 50,000 characters, including the student's whitespace. The lecture must be open and the draft must match the current code broadcast revision. The authenticated student must be a member. A code submission awards zero participation points. A student can read only their own latest accepted code while the lecture is open. The owner can read the current broadcast and operation receipts.

## Participation and Canvas reports

Each lecture has a private roster scope. Joining the lecture permits live participation but does not verify enrollment. The lecture owner can import 1 to 500 roster records with this exact UTF-8 CSV header:

```csv
email,display_name,canvas_identifier
```

The import trims fields and compares email addresses without case differences. Every email and Canvas identifier must be unique within the roster. The roster replaces the previous revision as one retry-safe operation. Students cannot read or write roster data.

The participation CSV contains each joined account's verified Google email, available Google display name, one credit column for each graded question that is not skipped, and the total. Ungraded and skipped questions are excluded. Students with no credit remain in the report with a zero total.

The Canvas CSV contains `canvas_identifier` and `participation_score`. It includes only joined accounts with one unambiguous roster match. An account with no match is listed for instructor review. If multiple Firebase UIDs joined with the same normalized email, every account with that email is withheld for review. The system does not reconcile accounts automatically.

The reporting panel does not subscribe to private reporting data or generate a report automatically. On instructor request, it fetches a fresh owner-authorized status snapshot containing the number of joined students, the number who submitted at least one answer, awarded participation points, roster records, and the snapshot time. CSV generation remains a separate explicit action and uses the latest server data at the time the instructor clicks the download button.

Both exports remain available to the lecture owner after archive. The server creates the CSV and protects cells that spreadsheet programs could interpret as formulas. The application never asks a student for a Canvas identifier or student ID.

## Production gates

The repository now defines shared-device cleanup, an owner-authorized lecture deletion workflow, a data inventory, and a proposed retention baseline in [the data governance reference](data-governance.md). Signing out removes that account's local drafts. An owner can permanently delete an archived lecture and all of its lecture-scoped private records by confirming its code.

A real-data pilot still requires the university owner to approve the actual retention interval, Firebase data handling, incident process, and Canvas identifier/template. Hosted Firebase and production Google OAuth must also be smoke-tested with authorized synthetic accounts. These external gates do not block local emulator development.
