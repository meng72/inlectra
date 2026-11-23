# InLectra

Live classroom activities without a heavyweight learning platform.

InLectra helps university instructors run questions, code walkthroughs, class Q&A, and participation checks during a lecture. Students join from a QR code, move among the activities that are currently available, and revise their answers without earning duplicate credit.

> [!IMPORTANT]
> InLectra is a pre-release research project. Use the Firebase emulators and synthetic accounts for development. Do not deploy it with real student data until your institution approves the data handling, retention, incident response, and roster-mapping process.

## Why InLectra

Classroom response tools often separate polling, code sharing, student questions, and attendance into different products. InLectra keeps those activities in one live lecture workspace while placing identity checks, grading rules, and private data behind trusted backend operations.

The participation model is intentionally straightforward. A student earns one point for submitting a graded question, regardless of correctness. Revisions update the answer but do not award another point.

## What you can do

### Instructors

- Organize lectures and reusable question banks by course number and semester.
- Import `MC`, `MR`, `TF`, `NUM`, and `ESSAY` questions from CSV.
- Create and edit questions during a live lecture.
- Reorder or shuffle a lecture queue, then publish, hide, skip, or restore questions.
- Publish or hide the full lecture queue with one action.
- Share a presentation-focused QR page for student joining.
- Broadcast text or syntax-highlighted code and call attention to selected lines.
- Review private student questions and publish selected questions anonymously.
- Refresh a live participation summary when needed.
- Export participation CSV and roster-matched Canvas CSV files.
- Reopen archived lectures for reports or permanent deletion.

### Students

- Join a live lecture with a QR code or a 12-character session code.
- Navigate among all questions that the instructor has made available.
- Submit and revise multiple-choice, multiple-response, numeric, and essay answers.
- View statistics and answer keys only after the instructor reveals them.
- Follow the instructor's whiteboard and make a private copy of shared code.
- Keep private code drafts in IndexedDB until choosing to submit them.
- Ask the instructor private questions and read anonymous questions shared with the class.

## A lecture in four steps

1. The instructor selects a course, creates a lecture, and displays its QR code.
2. Students sign in with Google and join the live lecture.
3. The instructor publishes questions, whiteboard content, or class Q&A updates.
4. The instructor archives the lecture and downloads participation reports.

Students cannot browse archived lecture content. The instructor retains owner-authorized access to archived reports and deletion controls.

## Privacy and grading rules

InLectra treats the browser as an interface, not an authorization boundary.

- Firebase UID is the internal account identifier.
- Verified Google email appears only in restricted participation reporting.
- Students never enter a student ID.
- Cloud Functions recheck the Google provider, verified email, role, ownership, membership, and lecture state for trusted operations.
- Realtime Database rules block direct client writes and protect private submissions, emails, answer keys, grades, rosters, and operation receipts.
- Private code drafts stay in IndexedDB until the student selects **Submit private code**.
- Canvas exports omit unmatched accounts, ambiguous matches, and duplicate participant emails.

Read the [requirements](docs/requirements.md), [architecture](docs/architecture.md), and [data governance notes](docs/data-governance.md) for the complete trust model.

## Technology

| Area | Technology |
| --- | --- |
| Frontend | React, TypeScript, and Vite |
| Static hosting target | GitHub Pages |
| Authentication | Firebase Authentication with Google Sign-In |
| Live data | Firebase Realtime Database |
| Trusted operations | Firebase Cloud Functions |
| Private browser drafts | IndexedDB |
| Tests | Node test runner, Firebase Emulator Suite, and Playwright |

## Project status

The current implementation covers the planned local milestones for authentication, course workspaces, question banks, polling, answer revisions, participation credit, whiteboard broadcasting, private code drafts, student Q&A, reporting, and archive discovery.

The verification suite includes an 80-student synthetic emulator run at concurrency 10. That run checks correctness and data consistency on loopback services. It does not predict hosted Firebase latency or capacity.

Before a hosted pilot, the project still needs institutional approval and a synthetic production smoke test. See the [implementation plan](docs/implementation-plan.md) and [local pilot checklist](docs/local-pilot-acceptance-checklist.md).

## Run InLectra locally

### Prerequisites

- Node.js 22.12 or later in the 22.x series
- npm
- Java 21 on `PATH`

On an Apple Silicon Mac with Homebrew, install Java with:

```sh
brew install openjdk@21
export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"
```

### Start the app

1. Install dependencies.

   ```sh
   npm ci
   ```

2. Start Firebase Auth, Realtime Database, and Cloud Functions emulators.

   ```sh
   npm run emulators
   ```

3. In another terminal, start Vite.

   ```sh
   npm run dev
   ```

4. Open the Vite URL and select **Sign in with Google**. The Auth emulator creates a fictional account.

5. Open the Emulator Suite at `http://127.0.0.1:4000`, copy the fictional account's UID, and grant the local instructor claim.

   ```sh
   npm run grant:instructor -- <uid>
   ```

6. Sign out, sign in again, create a course workspace, and start a lecture.

For a complete instructor and student rehearsal, follow the [local pilot runbook](docs/local-pilot-runbook.md). Use only the synthetic files in [`examples/pilot`](examples/pilot).

### Local QR limitation

A phone that scans a loopback URL tries to connect to itself. During emulator testing, open the student join link in a separate browser profile on the same computer.

## Import questions from CSV

Use this exact UTF-8 header and column order:

```csv
Type,Title,Points,Question,Answer,Choice1,Choice2,Choice3,Choice4,Choice5
MC,,1,"Which value is even?",2,1,2,3,5,
MR,,1,"Select the even values.",24,1,2,3,4,
TF,,1,"A revision earns another point.",0,TRUE,FALSE,,,
NUM,,1,"How many points can one graded question award?",1,,,,,
ESSAY,,0,"Explain your reasoning.",____,,,,,
```

Each import accepts 1 to 100 records. An invalid record blocks the full import. Read the [question import reference](docs/requirements.md#question-bank-and-publication) for answer encoding, field limits, and question states.

## Verify a change

Stop any running emulators, then run:

```sh
npm run verify
```

The command runs lint, TypeScript checks, frontend and Functions builds, the main bundle budget, unit tests, callable and security-rule tests, the 80-student synthetic load check, and the Chromium instructor-student workflow.

Useful focused commands include:

```sh
npm test
npm run test:integration
npm run test:load
npm run test:e2e
```

## Repository guide

| Path | Contents |
| --- | --- |
| [`src`](src) | React interface, Firebase client boundary, and IndexedDB drafts |
| [`functions/src`](functions/src) | Trusted operations, validation, and report generation |
| [`tests`](tests) | Unit, callable, rules, load, and browser tests |
| [`docs/requirements.md`](docs/requirements.md) | Product requirements and acceptance criteria |
| [`docs/architecture.md`](docs/architecture.md) | Data ownership, authorization, and concurrency design |
| [`docs/implementation-plan.md`](docs/implementation-plan.md) | Completed milestones and remaining pilot work |
| [`docs/data-governance.md`](docs/data-governance.md) | Data inventory, retention boundary, and production gates |

## Contributing

Use GitHub issues for bug reports and focused feature proposals. Do not include student records, real roster files, credentials, Firebase secrets, or other private course data in an issue, commit, or test fixture.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a change. Security-sensitive changes must preserve the authorization and data boundaries documented in the [architecture](docs/architecture.md) and [data governance notes](docs/data-governance.md).

## License

InLectra is source-available under the [CETD Attribution NonCommercial ShareAlike Academic Software License](LICENSE). Academic and nonprofit researchers may use, modify, and redistribute the software free of charge for educational or academic research purposes, subject to the complete license terms.

Commercial entities should contact `innovation@uta.edu` for licensing opportunities.
