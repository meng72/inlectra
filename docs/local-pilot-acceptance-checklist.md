# Local pilot acceptance checklist

Copy this file for each rehearsal. Record `Pass`, `Fail`, or `Not run` in the Result column. Add a screenshot name, downloaded file name, or short observation in Evidence.

## Rehearsal record

| Field | Value |
| --- | --- |
| Date | |
| Facilitator | |
| Commit | |
| Operating system | |
| Node version | |
| Java version | |
| Browsers | |

## Environment and identity

| ID | Acceptance check | Result | Evidence |
| --- | --- | --- | --- |
| ENV-01 | `npm run verify` exits with code 0 while the emulators are stopped. | | |
| ENV-02 | The app and Emulator Suite run on loopback addresses. | | |
| AUTH-01 | A fictional Google account can sign in through the Auth emulator. | | |
| AUTH-02 | A student account cannot create a lecture. | | |
| AUTH-03 | The granted instructor claim appears only after a fresh sign-in. | | |
| AUTH-04 | No screen asks a student for a student ID. | | |

## Sessions and questions

| ID | Acceptance check | Result | Evidence |
| --- | --- | --- | --- |
| SES-01 | The instructor creates one lecture and receives a join link, QR code, and 12-character code. | | |
| SES-02 | Eight fictional students join from isolated browser profiles. | | |
| SES-03 | A refresh or repeated join does not create a duplicate participant. | | |
| Q-01 | The supplied question CSV imports five valid records. | | |
| Q-02 | Reorder and shuffle preserve every queued question. | | |
| Q-03 | Students can switch among all available questions. | | |
| Q-04 | Hide, skip, restore, and republish produce the documented states. | | |
| Q-05 | A republished question starts with statistics and the correct answer hidden. | | |

## Answers and participation

| ID | Acceptance check | Result | Evidence |
| --- | --- | --- | --- |
| ANS-01 | Each first submission to a graded question awards one point regardless of correctness. | | |
| ANS-02 | A revision changes the accepted answer without adding credit. | | |
| ANS-03 | A retried operation returns its original result without adding credit. | | |
| ANS-04 | Two concurrent revisions allow one commit and reject the stale revision. | | |
| ANS-05 | Students cannot see another student's answer. | | |
| ANS-06 | Students see statistics and the correct answer only after separate instructor reveals. | | |

## Broadcast and drafts

| ID | Acceptance check | Result | Evidence |
| --- | --- | --- | --- |
| BC-01 | Students receive the current code, language, and instructor line highlights. | | |
| BC-02 | A private draft survives reload and remains private to its account and browser origin. | | |
| BC-03 | A later broadcast does not overwrite a private draft. | | |
| BC-04 | A stale draft cannot be submitted against a newer broadcast revision. | | |
| BC-05 | The app uploads code only after **Submit private code** is selected. | | |

## Reports, archive, and cleanup

| ID | Acceptance check | Result | Evidence |
| --- | --- | --- | --- |
| REP-01 | The supplied roster imports eight unique fictional mappings. | | |
| REP-02 | The participation CSV contains joined accounts, graded credits, and totals. | | |
| REP-03 | The Canvas CSV contains only unambiguous matched accounts. | | |
| REP-04 | An unmatched account appears for review and is withheld from the Canvas CSV. | | |
| ARC-01 | Archive revokes active student views and blocks new joins. | | |
| ARC-02 | The owner can export reports after archive. | | |
| DEL-01 | Deletion requires the exact code and removes the archived lecture. | | |
| PRIV-01 | Students cannot read roster data, verified emails, answer keys before reveal, grades, or other students' submissions. | | |

## Exit decision

| Decision | Value |
| --- | --- |
| Overall result | |
| Blocking failures | |
| Follow-up owner | |
| Follow-up date | |

The local pilot passes only when every required row has `Pass`. A `Fail` or `Not run` result blocks a hosted synthetic pilot until the team resolves or accepts the gap.
