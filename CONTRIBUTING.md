# Contributing to InLectra

InLectra welcomes focused bug fixes, tests, documentation improvements, and feature proposals from academic and nonprofit researchers.

## Before you start

Use a GitHub issue to describe a proposed feature or a substantial behavior change before writing the implementation. Keep each pull request limited to one reviewable problem.

Never include real student records, course rosters, credentials, Firebase secrets, private keys, production configuration, or identifiable classroom data in an issue, commit, fixture, screenshot, or test report. Use synthetic accounts under `example.test`.

## Set up the project

Install Node.js 22.12 or later in the 22.x series and Java 21. Then run:

```sh
npm ci
npm run emulators
```

In another terminal, start the interface:

```sh
npm run dev
```

The [local pilot runbook](docs/local-pilot-runbook.md) covers a complete instructor and student rehearsal.

## Make a change

- Keep Firebase initialization and client transport code in `src/firebase.ts`.
- Treat browser authorization as display logic only.
- Put trusted writes in Cloud Functions.
- Recheck identity, role, ownership, membership, and lecture state in each trusted operation.
- Keep private records outside student-readable database paths.
- Preserve retry receipts and participation-credit idempotency.
- Add the smallest executable behavior test that protects the change.

Read the [requirements](docs/requirements.md), [architecture](docs/architecture.md), and [data governance notes](docs/data-governance.md) before changing security-sensitive behavior.

## Verify the change

Stop any running emulators, then run:

```sh
npm run verify
```

The command runs lint, builds, unit tests, callable and security-rule tests, an 80-student synthetic load check, and the Chromium instructor-student workflow.

## Submit the change

Describe the user-visible outcome, tests executed, remaining risks, and any follow-up work in the pull request. Do not include generated build output or local emulator data.

By contributing, you agree that your contribution is distributed under the repository's [license](LICENSE).
