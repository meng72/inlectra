# Implementation plan

## 1. Establish identity and create lectures

Build the static app, Auth, Functions, and Database emulators, a local instructor grant, and trusted session creation. The browser accepts a verified Google identity. The backend validates the role and records the owner. The rules restrict direct reads and writes.

Run the unit, callable, and rules suites. Confirm that an instructor can create and read a session, a student cannot create one, and another instructor cannot read it. Build the frontend with a relative asset base for GitHub Pages.

## 2. Admit students and close lectures

Implemented QR links, typed codes, private memberships, retry-safe creation, and owner-only archive. New joins expire after eight hours. The emulator suites cover concurrent joins, retry receipts, expiry, cross-session access, and archive revocation on an active listener. Retention still needs a decision before a pilot.

## 3. Publish questions

Implemented CSV preview and atomic import, live question creation, instructor-owned question-bank editing, newest-modified-first ordering, and a revisioned lecture queue. Bank creation and edits use owner-authorized, retry-safe operations; edits reject stale revisions and do not mutate existing lecture snapshots. Instructors can move, shuffle, publish or hide the full queue, and publish, hide, skip, or restore individual questions. Students can navigate available questions. Unit and emulator suites cover validation, key privacy, command retries, concurrent writes, and archive.

Decide how long to keep import and plan receipts before a pilot. Exercise large banks and bursts of joins against the per-bank and per-lecture transactions.

## 4. Accept revisions and award participation

Implemented private submissions, revision conflicts, and one participation point per graded question. The lecture snapshot fixes grading status. Instructors can independently reveal aggregate statistics and configured correct answers.

Run `npm run verify` with the emulators stopped. The suites cover concurrent retries, competing revisions, aggregate counts, reveal permissions, private responses, and archive. Test submission bursts across a synthetic class before the pilot. Set retention for answers and retry receipts.

## 5. Broadcast text and code

Implemented live text and code, syntax and line highlighting, account-scoped IndexedDB drafts, and explicit code uploads with revision checks. Run `npm run verify` with the emulators stopped. Storage and emulator tests cover draft isolation, revision conflicts, private reads, and archive.

Before a pilot, test browser drafts and submission under the class-size workload. Set a retention policy for submitted code and operation receipts. Set a cleanup policy for drafts on shared devices.

## 6. Export reports and prepare a pilot

Implemented an on-demand lecture status dashboard, lecture-owner participation CSV, private roster replacement, matched Canvas CSV, and explicit unmatched-account review. The dashboard reads joined, participating, point, and roster counts only when the instructor requests a snapshot. CSV generation occurs only on download and protects cells from spreadsheet formula interpretation. The callable and rules suites cover ownership, direct-access denial, retry-safe roster changes, post-archive export, display names, email mismatches, and duplicate participant emails.

The repeatable load command exercises 80 authenticated students joining and submitting the same graded question in bounded concurrent waves. The default concurrency is 10 and is printed with every result; `INLECTRA_LOAD_CONCURRENCY` can raise it for exploratory stress runs. The harness retries only transient callable transport failures, reuses the exact same idempotent request, and prints the retry count. Authorization, validation, and business-state failures are not retried. The test verifies every point, stored response, aggregate, and report row and emits per-round error/work counts and latency percentiles for diagnostics. Emulator timing and saturation are not hosted-service capacity claims. Concurrency 20 and same-millisecond stress can disconnect the single-process emulator, so those modes are diagnostic rather than release gates. Stress runs also exposed the Realtime Database transaction retry ceiling. Jittered bounded retry for `maxretry` preserves the archive-safe transaction.

Local pre-pilot hardening now pins Node 22 and Java 21 in CI, enforces a 200 KiB gzip budget for the main JavaScript entry, runs the rule/callable/load suites, and runs a Chromium pilot path covering create, publish, join, submit, roster import, Canvas export, archive, and deletion. Owner deletion and automatic account-draft cleanup implement the repository-side governance controls. Run `npm run test:load:pilot` for ten clean 80-student correctness rounds at the default concurrency.

The local milestone 6 soak completed ten rounds at concurrency 10 with 800 synthetic student joins, 800 accepted graded submissions, zero request errors, and matching response, aggregate, and report counts. These are correctness counts from loopback emulators, not production latency or capacity measurements.

The local pilot package provides a repeatable manual rehearsal in [the local pilot runbook](local-pilot-runbook.md), a pass or fail record in [the acceptance checklist](local-pilot-acceptance-checklist.md), and validated synthetic CSV fixtures in [`examples/pilot`](../examples/pilot). Complete this rehearsal before requesting a hosted synthetic pilot.

Obtain explicit approval before production setup, deployment, or use of real student records. Approve the proposed retention baseline and confirm the Canvas identifier expected by the university roster export. Run a production-like network test before a live pilot because emulator timing does not predict hosted Firebase latency.

## 7. Accept and moderate student questions

Implemented a private, real-time student question inbox. Joined students can submit, revise, or withdraw their own private questions during an open lecture. The owner can optionally reveal identities in the private inbox, publish a sanitized anonymous copy to the class, mark it answered, or dismiss it. Student questions award no participation credit and never enter the reusable question bank.

Trusted admission transactions serialize creation, revision, moderation, publication, and archive. Operation receipts make retries idempotent, expected revisions reject concurrent overwrites, and security rules limit students to their own records. Unit, rules, callable, and browser tests cover anonymous projection, identity privacy, concurrent revisions, archive, and the full student-to-instructor workflow.

## 8. Consolidate the instructor workspace

Implemented a session-focused command bar and three primary workspace views: live control, question bank, and reports. The live view keeps broadcast and lecture-queue controls together; the private student-question inbox opens as a drawer without replacing the current view. Session creation is hidden after a lecture starts, and ending a class uses a confirmation dialog. Workspace navigation changes presentation without remounting question-bank state.

The browser pilot covers view changes, preserved bank filters, QR presentation, the inbox drawer, live broadcast, on-demand reporting, end-class confirmation, and page-width checks at 375-by-812 portrait and 812-by-375 landscape sizes.

## 9. Consolidate the student workspace

Implemented three student task views: activities, whiteboard, and class Q&A. All panels remain mounted so switching views does not discard unfinished answers, question edits, or private code drafts. Student-facing copy uses “whiteboard” while trusted operations retain their internal broadcast terminology.

The Class Q&A view separates private submissions from anonymous class questions and initially renders five records in each list. Students can reveal five more at a time or collapse the list. The browser pilot publishes six anonymous questions to verify the boundary, keyboard tab navigation, state preservation, shared code display, and portrait and landscape page width.

## 10. Scope question banks by course and semester

Added instructor-owned course workspaces with required course number and semester. Lecture creation now requires a selected workspace and retains its immutable ID. Question import, creation, editing, deletion, and lecture-plan additions are authorized and stored by course ID, allowing reuse across lectures in one course and semester without exposing questions to another class.

Instructor and student session headers show the trusted course number and semester above the lecture title. Lecture creation snapshots that context onto the session and its student-readable live projection, keeping both workspaces consistent without granting students access to private course records.

## 11. Separate course navigation and archive discovery

Reorganized the instructor course workspace into Lectures, Question bank, and Archives views. The full bank no longer stacks below lecture setup, while an active lecture retains the same Question bank tools for live imports and creation. A backend-maintained, owner-only course lecture index lists open and archived sessions without granting browser access to the private session collection. Archive and deletion update that index with the lecture lifecycle.
