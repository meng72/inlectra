# Run a local classroom pilot

Use this procedure to rehearse one lecture on the Firebase emulators. Use fictional accounts and the supplied synthetic CSV files. Do not use real student data.

Record each result in [the local pilot acceptance checklist](local-pilot-acceptance-checklist.md).

## Prepare the computer

1. Install Node.js 22.12 or later in the 22.x series.
2. Install Java 21 and make `java` available on your path.
3. Stop any InLectra emulator process that is already running.
4. Run the repository checks:

	```sh
	npm ci
	npm run verify
	```

5. Confirm that `npm run verify` exits with code 0.

## Start the local services

1. Start the emulators in the first terminal:

	```sh
	npm run emulators
	```

2. Leave the emulator process running.
3. Start the app in a second terminal:

	```sh
	npm run dev
	```

4. Open the Vite URL in an instructor browser profile.
5. Open `http://127.0.0.1:4000` in another tab. Confirm that the Firebase Emulator Suite page loads.

## Create the fictional accounts

1. Select **Sign in with Google** in the instructor profile.
2. Create a fictional account named `Synthetic Instructor` in the emulator popup.
3. Open the Authentication page in the Emulator Suite.
4. Copy the instructor UID.
5. Grant the local instructor claim from a third terminal:

	```sh
	npm run grant:instructor -- <uid>
	```

6. Sign out of InLectra and sign in again with the instructor account.
7. Confirm that **Create a lecture session** appears.
8. Create eight isolated student browser profiles.
9. In those profiles, create `student01@example.test` through `student08@example.test` with the display names in [`examples/pilot/roster.csv`](../examples/pilot/roster.csv).

Use separate browser profiles or contexts. Incognito windows in one profile can share or clear state in ways that obscure account-isolation failures.

## Create and join the lecture

1. Create a lecture named `Synthetic local pilot` in the instructor profile.
2. Copy the join link and the 12-character session code.
3. Open the join link in each student profile.
4. Sign in and select **Join lecture** in each profile.
5. Confirm that all eight students see the lecture title.
6. Refresh one student profile. Confirm that the student can rejoin without creating a second participant.

Do not scan the loopback QR code with a phone. A loopback URL on a phone points to the phone, not to the development computer.

## Import and control questions

1. Open **Import questions from CSV** in the instructor profile.
2. Choose [`examples/pilot/questions.csv`](../examples/pilot/questions.csv).
3. Confirm that the preview lists five questions without validation errors.
4. Select **Import questions**.
5. Add all five questions to the lecture queue.
6. Reorder two questions and shuffle the queue. Confirm that no question disappears.
7. Publish the first two graded questions.
8. Confirm that each student can switch between both available questions.
9. Hide one published question. Confirm that it disappears from every student profile.
10. Restore and republish that question. Confirm that statistics and the correct answer start hidden.
11. Skip the ungraded question, restore it, and then publish it.

## Submit and revise answers

1. Have all students submit an answer to the first graded question.
2. Have `student01@example.test` revise the answer.
3. Confirm that the student still has one point for that question.
4. Submit the same answer again after a network retry or page refresh. Confirm that the point does not increase.
5. Open the same student in two tabs.
6. Submit different revisions from both tabs without reloading the second tab.
7. Confirm that one revision succeeds and the other asks for a refresh.
8. Reveal statistics. Confirm that students see only the aggregate.
9. Reveal the correct answer. Confirm that students see it only after the instructor reveal.
10. Hide the question. Republish it and confirm that both reveals are off.

## Rehearse the code workflow

1. Open **Lecture broadcast** in the instructor profile.
2. Choose **Code**, select TypeScript, and enter at least five lines.
3. Select two lines in the preview and select **Send broadcast**.
4. Confirm that every student sees the syntax highlighting and selected lines.
5. In the `student01@example.test` profile, select **Start private copy**.
6. Edit the code and wait for **Saved on this device**.
7. Reload and rejoin. Confirm that the private draft returns.
8. Update the instructor broadcast. Confirm that the private draft stays unchanged.
9. Confirm that the stale-draft warning appears and **Submit private code** is disabled.
10. Save the draft outside the app if you need it, then select **Reset to latest code**.
11. Edit and submit the current draft. Confirm that the accepted revision appears.

## Export participation

1. Open **Participation reports** in the instructor profile.
2. Choose [`examples/pilot/roster.csv`](../examples/pilot/roster.csv).
3. Select **Replace roster**.
4. Download the participation CSV.
5. Confirm that the file contains eight fictional emails and one column per graded question that is not skipped.
6. Confirm that answer revisions did not add credit.
7. Download the Canvas CSV.
8. Confirm that each matched account appears once with its `canvas-synthetic` identifier.
9. Join with one extra fictional account that is absent from the roster.
10. Download both files again. Confirm that the participation file includes the account and the Canvas file withholds it for review.

## Archive and delete the lecture

1. Select **Archive lecture**, then select **Confirm archive**.
2. Confirm that every connected student loses the live lecture view.
3. Try the original join link from a new profile. Confirm that the archive blocks the join.
4. Download both reports as the instructor. Confirm that post-archive export still works.
5. Open **Permanently delete lecture data**.
6. Enter the exact session code and confirm deletion.
7. Confirm that the instructor and student profiles report that the session is unavailable.
8. Stop the Vite process and the emulators.

The emulator data disappears when you stop the emulators unless you started them with an export option.
