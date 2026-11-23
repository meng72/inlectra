import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { deleteApp, initializeApp } from "firebase/app";
import {
	connectAuthEmulator,
	getAuth,
	GoogleAuthProvider,
	signInWithCredential,
	signOut,
} from "firebase/auth";
import {
	deleteApp as deleteAdmin,
	initializeApp as initializeAdmin,
} from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getDatabaseWithUrl } from "firebase-admin/database";

const projectId = "demo-inlectra";
const studentCount = Number.parseInt(
	process.env.INLECTRA_LOAD_STUDENTS ?? "80",
	10,
);
const rounds = Number.parseInt(process.env.INLECTRA_LOAD_ROUNDS ?? "1", 10);
const concurrency = Number.parseInt(
	process.env.INLECTRA_LOAD_CONCURRENCY ?? "10",
	10,
);
assert.ok(Number.isInteger(studentCount) && studentCount >= 1 && studentCount <= 100);
assert.ok(Number.isInteger(rounds) && rounds >= 1 && rounds <= 10);
assert.ok(
	Number.isInteger(concurrency) &&
		concurrency >= 1 &&
		concurrency <= studentCount,
);

process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIREBASE_DATABASE_EMULATOR_HOST = "127.0.0.1:9000";
const admin = initializeAdmin({ projectId });
const app = initializeApp({
	projectId,
	apiKey: "demo-key",
	databaseURL: "https://demo-inlectra-default-rtdb.firebaseio.com",
});
const auth = getAuth(app);
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
const adminDb = getDatabaseWithUrl(app.options.databaseURL, admin);

after(async () => {
	await signOut(auth);
	await deleteApp(app);
	await deleteAdmin(admin);
});

function percentile(values, fraction) {
	const ordered = [...values].sort((a, b) => a - b);
	return ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)];
}

async function invoke(name, token, data) {
	const startedAt = performance.now();
	const response = await fetch(
		`http://127.0.0.1:5001/${projectId}/us-central1/${name}`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ data }),
		},
	);
	const payload = await response.json();
	if (!response.ok) {
		const error = new Error(JSON.stringify(payload));
		error.retryable =
			response.status >= 500 ||
			new Set(["INTERNAL", "UNAVAILABLE", "DEADLINE_EXCEEDED"]).has(
				payload?.error?.status,
			);
		throw error;
	}
	return { result: payload.result, elapsedMs: performance.now() - startedAt };
}

async function invokeWithTransientRetry(name, token, data) {
	const startedAt = performance.now();
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			const response = await invoke(name, token, data);
			return {
				...response,
				elapsedMs: performance.now() - startedAt,
				retries: attempt,
			};
		} catch (error) {
			if (!error?.retryable || attempt === 2) throw error;
			await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
		}
	}
	throw new Error("Transient retry loop ended unexpectedly.");
}

async function runInWaves(items, operation) {
	const results = [];
	for (let offset = 0; offset < items.length; offset += concurrency) {
		results.push(
			...(await Promise.allSettled(
				items.slice(offset, offset + concurrency).map(operation),
			)),
		);
	}
	return results;
}

test(`${studentCount} authenticated students complete ${rounds} load rounds at concurrency ${concurrency}`, {
	timeout: 600_000,
}, async () => {
	const ownerSub = randomUUID();
	const { user: owner } = await signInWithCredential(
		auth,
		GoogleAuthProvider.credential(
			JSON.stringify({
				sub: ownerSub,
				email: `${ownerSub}@example.test`,
				email_verified: true,
			}),
		),
	);
	await getAdminAuth(admin).setCustomUserClaims(owner.uid, { instructor: true });
	const ownerToken = await owner.getIdToken(true);
	const course = (
		await invoke("createCourse", ownerToken, {
			courseNumber: "CSE LOAD",
			semester: "Fall 2026",
			operationId: randomUUID(),
		})
	).result;

	for (let round = 1; round <= rounds; round++) {
		const session = (
			await invoke("createSession", ownerToken, {
				title: `Load round ${round}`,
				operationId: randomUUID(),
				courseId: course.id,
			})
		).result;
		const imported = (
			await invoke("importQuestions", ownerToken, {
				courseId: course.id,
			operationId: randomUUID(),
			rows: [
				["MC", "", "1", "Ready?", "1", "Yes", "No", "", "", ""],
			],
			})
		).result;
		await invoke("mutateQuestionPlan", ownerToken, {
			id: session.id,
			expectedRevision: 0,
			operationId: randomUUID(),
			operation: { kind: "add", id: imported.ids[0] },
		});
		await invoke("mutateQuestionPlan", ownerToken, {
			id: session.id,
			expectedRevision: 1,
			operationId: randomUUID(),
			operation: { kind: "publish", id: imported.ids[0] },
		});

		const students = [];
		for (let index = 0; index < studentCount; index++) {
			const sub = randomUUID();
			const email = `load-${round}-${index}-${sub}@example.test`;
			const { user } = await signInWithCredential(
				auth,
				GoogleAuthProvider.credential(
					JSON.stringify({ sub, email, email_verified: true }),
				),
			);
			students.push({ token: await user.getIdToken() });
		}
		const joinStartedAt = performance.now();
		const joins = await runInWaves(
			students,
			({ token }) =>
				invokeWithTransientRetry("joinSession", token, { id: session.id }),
		);
		const joinElapsedMs = performance.now() - joinStartedAt;
		const submissions = await runInWaves(
			students,
			({ token }) =>
				invokeWithTransientRetry("submitAnswer", token, {
					id: session.id,
					questionId: imported.ids[0],
					operationId: randomUUID(),
					expectedRevision: 0,
					answer: { type: "multiple-choice", option: "A" },
				}),
		);
		const joinErrors = joins.filter(({ status }) => status === "rejected");
		const submissionErrors = submissions.filter(
			({ status }) => status === "rejected",
		);
		const fulfilled = submissions.flatMap((submission) =>
			submission.status === "fulfilled" ? [submission.value] : [],
		);
		const fulfilledJoins = joins.flatMap((join) =>
			join.status === "fulfilled" ? [join.value] : [],
		);
		const activity = (
			await adminDb
				.ref(`admissions/${session.id}/questionActivity/${imported.ids[0]}`)
				.get()
		).val();
		const report = (
			await invoke("createReport", ownerToken, {
				id: session.id,
				kind: "participation",
			})
		).result;
		const latencies = fulfilled.map(({ elapsedMs }) => elapsedMs);
		console.log(
			JSON.stringify({
				round,
				students: studentCount,
				concurrency,
				joinElapsedMs: Math.round(joinElapsedMs),
				submissionP50Ms: Math.round(percentile(latencies, 0.5)),
				submissionP95Ms: Math.round(percentile(latencies, 0.95)),
				submissionP99Ms: Math.round(percentile(latencies, 0.99)),
				joinErrors: joinErrors.length,
				submissionErrors: submissionErrors.length,
				joinRetries: fulfilledJoins.reduce(
					(total, result) => total + result.retries,
					0,
				),
				submissionRetries: fulfilled.reduce(
					(total, result) => total + result.retries,
					0,
				),
				storedResponses: Object.keys(activity?.responses ?? {}).length,
				reportRows: report.rowCount,
			}),
		);
		assert.equal(joinErrors.length, 0);
		assert.equal(submissionErrors.length, 0);
		assert.equal(fulfilled.length, studentCount);
		assert.ok(
			fulfilled.every(
				({ result }) => result.participationPoint === 1,
			),
		);
		assert.equal(Object.keys(activity.responses).length, studentCount);
		assert.equal(activity.publicStats.total, studentCount);
		assert.equal(report.rowCount, studentCount);
		assert.equal(report.csv.match(/\r\n/g).length, studentCount + 1);
	}
});
