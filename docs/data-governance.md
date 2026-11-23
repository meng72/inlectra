# Data governance reference

This document is the repository's conservative operating policy for synthetic development and a proposed baseline for a future pilot. It is not a substitute for university records, privacy, or retention policy. Do not enable a real-data pilot until the responsible university owner approves the deployment and retention schedule.

## Data inventory

| Data | Location | Readers | Removal |
| --- | --- | --- | --- |
| Lecture metadata and creation receipt | `sessions/{id}`, `createOperations/{ownerUid}/{operationId}` | Lecture owner through rules; backend | Owner deletes archived lecture |
| Course lecture discovery summary | `courseLectures/{ownerUid}/{courseId}/{id}` | Owning instructor | Owner deletes archived lecture |
| Verified email, display name, and join time | `admissions/{id}/members/{uid}` | Backend reporting operations only | Owner deletes archived lecture |
| Question plan, answers, points, aggregates, code submissions, private student questions, and retry receipts | `admissions/{id}` | Narrow student projections or own accepted record; owner-authorized private views; backend | Owner deletes archived lecture |
| Imported roster and Canvas mapping | `reporting/{id}` | Owner-authorized callables only | Owner deletes archived lecture |
| Course and semester workspace | `courses/{ownerUid}/{courseId}` | Owning instructor | Administrative cleanup until course archival is designed |
| Reusable course question bank and import receipts | `questionBanks/{courseId}` | Instructor who owns the workspace | Instructor deletes individual questions; course-level cleanup remains an administrative process |
| Private code drafts | Browser IndexedDB | Current browser profile only | Explicit discard, browser storage clearing, or automatic removal for that account on sign-out |
| Downloaded reports | Instructor-selected local filesystem | Controlled by the instructor's device and institution | Follow the institution's approved storage and disposal policy |

The application does not collect student IDs. It takes UID, verified email, provider, and available display name from the authenticated token in trusted operations. Canvas identifiers enter only through an instructor-provided roster.

Student-submitted questions keep the author's UID, verified email, and available display name in the private lecture record. The instructor interface hides that identity by default but can reveal it to the authorized lecture owner. A published question is copied into the live view without any author identifier. Student questions are excluded from participation and Canvas reports.

## Local and proposed retention

- Emulator data is synthetic and disposable. The normal local test commands start clean temporary emulators and remove their data when they stop.
- Private drafts stay on the browser only while the student remains signed in or chooses to keep the browser session open. Signing out removes every draft for that Firebase UID before ending the session. If cleanup fails, sign-out fails visibly so the user can discard drafts or clear site storage.
- For a future real-data pilot, the proposed default is to archive at the end of the lecture and delete lecture-scoped data after the applicable grade-review or appeal window. The university owner must supply that date or retention interval; the software deliberately does not guess it.
- Question banks are instructor-authored course material and are not deleted with a lecture. Account closure and bulk question-bank retention require an administrative runbook before production.

## Owner deletion procedure

1. Export any report the instructor is authorized and required to retain.
2. Archive the lecture. This immediately ends student reads and submissions.
3. Open **Permanently delete lecture data**, type the exact session code, and confirm.
4. The trusted callable rechecks verified Google identity, instructor role, immutable ownership, archived state, and confirmation. One multi-location update removes the session, admission tree, roster/reporting tree, course lecture index entry, and creation receipt.
5. The lecture code then returns not found. The emulator integration and browser suites verify this behavior.

Deletion is permanent and has no application-level recovery. Firebase project backup, logging, and provider-level retention must be reviewed separately before production because they are external to this repository.

## Export controls

Participation exports contain verified Google email and display name. Canvas exports contain only unambiguous roster matches; unmatched and duplicate-email accounts are withheld for instructor review. CSV cells are quoted and protected against spreadsheet formula interpretation.

The `canvas_identifier` column is an adapter boundary, not a claim about a specific institution's Canvas import format. Validate it against a synthetic copy of the approved institutional roster/export template before enabling a real course.

## Incident and recovery boundary

Do not use real student records in the demo project. If a future authorized deployment exposes data, stop new access, preserve audit evidence, notify the designated university privacy/security owner, and follow university incident policy. Local deletion is not a replacement for provider-side incident response or backup deletion.

## Dependency review

Run `npm audit` during release review. As of the local milestone 6 review, npm reports no critical advisory. It reports a high advisory through the Firebase package's Firestore transport even though InLectra does not initialize or use Firestore. npm's automatic forced remediation would downgrade Firebase across a breaking major boundary, so it is not accepted silently. Recheck the advisory and Firebase release notes before any production release; development-tool advisories remain part of that review as well.
