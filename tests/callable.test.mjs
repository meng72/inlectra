import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { initializeApp, deleteApp } from "firebase/app";
import {
	getAuth,
	connectAuthEmulator,
	GoogleAuthProvider,
	signInWithCredential,
	signOut,
} from "firebase/auth";
import {
	getFunctions,
	connectFunctionsEmulator,
	httpsCallable,
} from "firebase/functions";
import {
	getDatabase,
	connectDatabaseEmulator,
	get,
	ref,
	set,
	goOffline,
	onValue,
} from "firebase/database";
import {
	initializeApp as initializeAdmin,
	deleteApp as deleteAdmin,
} from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getDatabaseWithUrl } from "firebase-admin/database";

const projectId = "demo-inlectra";
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
const functions = getFunctions(app, "us-central1");
connectFunctionsEmulator(functions, "127.0.0.1", 5001);
const db = getDatabase(app);
connectDatabaseEmulator(db, "127.0.0.1", 9000);
const adminDb = getDatabaseWithUrl(app.options.databaseURL, admin);
const learnerApp = initializeApp(app.options, "learner");
const learnerAuth = getAuth(learnerApp);
connectAuthEmulator(learnerAuth, "http://127.0.0.1:9099", {
	disableWarnings: true,
});
const learnerDb = getDatabase(learnerApp);
connectDatabaseEmulator(learnerDb, "127.0.0.1", 9000);
const learnerFunctions = getFunctions(learnerApp);
connectFunctionsEmulator(learnerFunctions, "127.0.0.1", 5001);
after(async () => {
	goOffline(learnerDb);
	await signOut(learnerAuth);
	await deleteApp(learnerApp);
	goOffline(db);
	await signOut(auth);
	await deleteApp(app);
	await deleteAdmin(admin);
});

async function createSyntheticCourse(client = functions, suffix = "Course") {
	return (
		await httpsCallable(client, "createCourse")({
			courseNumber: `CSE ${suffix}`,
			semester: "Fall 2026",
			operationId: randomUUID(),
		})
	).data;
}

test("students privately submit and revise questions while the owner moderates anonymous copies", {
	timeout: 30000,
}, async () => {
	const instructorSub = randomUUID();
	const { user: instructor } = await signInWithCredential(
		auth,
		GoogleAuthProvider.credential(
			JSON.stringify({
				sub: instructorSub,
				email: `${instructorSub}@example.test`,
				email_verified: true,
			}),
		),
	);
	await getAdminAuth(admin).setCustomUserClaims(instructor.uid, {
		instructor: true,
	});
	await instructor.getIdToken(true);
	const course = await createSyntheticCourse(functions, "QUESTIONS");
	const session = (
		await httpsCallable(functions, "createSession")({
			title: "Student question inbox",
			operationId: randomUUID(),
			courseId: course.id,
		})
	).data;

	const studentSub = randomUUID();
	const { user: student } = await signInWithCredential(
		learnerAuth,
		GoogleAuthProvider.credential(
			JSON.stringify({
				sub: studentSub,
				email: `${studentSub}@example.test`,
				email_verified: true,
				name: "Question Author",
			}),
		),
	);
	const mutate = httpsCallable(learnerFunctions, "mutateStudentQuestion");
	await assert.rejects(
		mutate({
			kind: "create",
			id: session.id,
			operationId: randomUUID(),
			text: "Not joined yet",
		}),
		{ code: "functions/permission-denied" },
	);
	await httpsCallable(learnerFunctions, "joinSession")({ id: session.id });
	const review = httpsCallable(functions, "reviewStudentQuestion");
	const createOperation = randomUUID();
	const createRequest = {
		kind: "create",
		id: session.id,
		operationId: createOperation,
		text: "Could you explain the second step?",
	};
	const created = (await mutate(createRequest)).data;
	assert.deepEqual((await mutate(createRequest)).data, created);
	await assert.rejects(
		mutate({ ...createRequest, text: "Different retry content" }),
		{ code: "functions/already-exists" },
	);
	assert.equal(created.revision, 1);
	assert.equal(created.reviewState, "open");
	assert.equal(created.visibility, "private");
	await assert.rejects(
		httpsCallable(learnerFunctions, "reviewStudentQuestion")({
			id: session.id,
			operationId: randomUUID(),
			studentUid: student.uid,
			questionId: created.questionId,
			expectedRevision: 1,
			action: "publish",
		}),
		{ code: "functions/permission-denied" },
	);
	const ownPath = `admissions/${session.id}/studentQuestions/${student.uid}`;
	assert.equal(
		(await get(ref(learnerDb, ownPath))).val()[created.questionId].text,
		"Could you explain the second step?",
	);
	await assert.rejects(
		get(ref(learnerDb, `admissions/${session.id}/studentQuestions`)),
		/permission.denied/i,
	);
	const ownerRecords = (
		await get(ref(db, `admissions/${session.id}/studentQuestions`))
	).val();
	assert.equal(
		ownerRecords[student.uid][created.questionId].authorEmail,
		`${studentSub}@example.test`,
	);

	const published = (
		await review({
			id: session.id,
			operationId: randomUUID(),
			studentUid: student.uid,
			questionId: created.questionId,
			expectedRevision: 1,
			action: "publish",
		})
	).data;
	assert.equal(published.visibility, "published");
	const live = (
		await get(ref(learnerDb, `admissions/${session.id}/live`))
	).val();
	assert.deepEqual(live.studentQuestions, [
		{
			id: created.questionId,
			text: "Could you explain the second step?",
			publishedAt: live.studentQuestions[0].publishedAt,
			answered: false,
		},
	]);
	assert.equal("authorUid" in live.studentQuestions[0], false);
	await assert.rejects(
		mutate({
			kind: "revise",
			id: session.id,
			operationId: randomUUID(),
			questionId: created.questionId,
			expectedRevision: 2,
			text: "Changed after publication",
		}),
		{ code: "functions/failed-precondition" },
	);
	await review({
		id: session.id,
		operationId: randomUUID(),
		studentUid: student.uid,
		questionId: created.questionId,
		expectedRevision: 2,
		action: "answer",
	});
	assert.equal(
		(
			await get(
				ref(
					learnerDb,
					`admissions/${session.id}/live/studentQuestions/0/answered`,
				),
			)
		).val(),
		true,
	);

	const second = (
		await mutate({
			kind: "create",
			id: session.id,
			operationId: randomUUID(),
			text: "Can I revise this question?",
		})
	).data;
	const revisions = await Promise.allSettled([
		mutate({
			kind: "revise",
			id: session.id,
			operationId: randomUUID(),
			questionId: second.questionId,
			expectedRevision: 1,
			text: "First concurrent revision",
		}),
		mutate({
			kind: "revise",
			id: session.id,
			operationId: randomUUID(),
			questionId: second.questionId,
			expectedRevision: 1,
			text: "Second concurrent revision",
		}),
	]);
	assert.equal(
		revisions.filter(({ status }) => status === "fulfilled").length,
		1,
	);
	assert.equal(
		revisions.filter(
			(result) =>
				result.status === "rejected" &&
				result.reason.code === "functions/aborted",
		).length,
		1,
	);

	await httpsCallable(functions, "archiveSession")({ id: session.id });
	await assert.rejects(
		mutate({
			kind: "create",
			id: session.id,
			operationId: randomUUID(),
			text: "Too late",
		}),
		{ code: "functions/failed-precondition" },
	);
	await signOut(learnerAuth);
	await signOut(auth);
});
test("synthetic instructors and students create, join, retry, and archive a lecture", {
	timeout: 30000,
}, async () => {
	const create = httpsCallable(functions, "createSession");
	await assert.rejects(create({ title: "Lecture" }), {
		code: "functions/unauthenticated",
	});
	const sub = randomUUID();
	const idToken = JSON.stringify({
		sub,
		email: `${sub}@example.test`,
		email_verified: true,
	});
	const { user } = await signInWithCredential(
		auth,
		GoogleAuthProvider.credential(idToken),
	);
	await assert.rejects(create({ title: "Lecture" }), {
		code: "functions/permission-denied",
	});
	await getAdminAuth(admin).setCustomUserClaims(user.uid, { instructor: true });
	await user.getIdToken(true);
	const course = await createSyntheticCourse(functions, "PARALLEL");
	const createCourse = httpsCallable(functions, "createCourse");
	assert.deepEqual(
		(
			await createCourse({
				courseNumber: course.courseNumber,
				semester: course.semester,
				operationId: course.operationId,
			})
		).data,
		course,
	);
	await assert.rejects(
		createCourse({
			courseNumber: "CSE OTHER",
			semester: course.semester,
			operationId: course.operationId,
		}),
		{ code: "functions/already-exists" },
	);
	const operationId = randomUUID();
	const input = {
		title: "  Parallel algorithms  ",
		operationId,
		courseId: course.id,
	};
	const [{ data }, replay] = await Promise.all([create(input), create(input)]);
	assert.deepEqual(data, replay.data);
	assert.deepEqual((await create(input)).data, data);
	await assert.rejects(create({ ...input, title: "Other title" }), {
		code: "functions/already-exists",
	});
	assert.match(data.id, /^[A-F0-9]{12}$/);
	assert.equal(data.joinCode, data.id);
	assert.equal(data.courseNumber, course.courseNumber);
	assert.equal(data.semester, course.semester);
	const record = (await get(ref(db, `sessions/${data.id}`))).val();
	assert.deepEqual(record, {
		id: data.id,
		joinCode: data.id,
		title: "Parallel algorithms",
		instructorUid: user.uid,
		state: "open",
		operationId,
		courseId: course.id,
		courseNumber: course.courseNumber,
		semester: course.semester,
		joinExpiresAt: record.createdAt + 8 * 60 * 60 * 1000,
		createdAt: record.createdAt,
	});
	assert.ok(Number.isSafeInteger(record.createdAt) && record.createdAt > 0);
	assert.deepEqual(
		(
			await get(
				ref(db, `courseLectures/${user.uid}/${course.id}/${data.id}`),
			)
		).val(),
		{
			id: data.id,
			joinCode: data.id,
			title: "Parallel algorithms",
			courseId: course.id,
			courseNumber: course.courseNumber,
			semester: course.semester,
			state: "open",
			createdAt: record.createdAt,
		},
	);

	const learnerId = randomUUID();
	const learnerEmail = `${learnerId}@example.test`;
	const { user: learner } = await signInWithCredential(
		learnerAuth,
		GoogleAuthProvider.credential(
			JSON.stringify({
				sub: learnerId,
				email: learnerEmail,
				email_verified: true,
			}),
		),
	);
	const join = httpsCallable(learnerFunctions, "joinSession");
	const archive = httpsCallable(functions, "archiveSession");
	const session = { id: data.id };
	const room = `admissions/${data.id}`;
	const view = ref(learnerDb, `${room}/live`);
	await assert.rejects(get(view), /permission.denied/i);
	const resumedOp = randomUUID();
	await adminDb.ref(`createOperations/${user.uid}/${resumedOp}`).set({
		id: data.id,
		title: "Recovered lecture",
		courseId: course.id,
		courseNumber: course.courseNumber,
		semester: course.semester,
		createdAt: Date.now(),
	});
	const recovered = (
		await create({
			operationId: resumedOp,
			title: "Recovered lecture",
			courseId: course.id,
		})
	).data;
	assert.notEqual(recovered.id, data.id);
	assert.equal(
		(
			await create({
				operationId: resumedOp,
				title: "Recovered lecture",
				courseId: course.id,
			})
		).data.id,
		recovered.id,
	);
	const overlap = await Promise.allSettled([
		join({ id: recovered.id }),
		archive({ id: recovered.id }),
	]);
	assert.equal(overlap[1].status, "fulfilled");
	if (overlap[0].status === "rejected")
		assert.equal(overlap[0].reason.code, "functions/failed-precondition");
	await assert.rejects(
		get(ref(learnerDb, `admissions/${recovered.id}/live`)),
		/permission.denied/i,
	);
	const [first, second] = await Promise.all([
		join({ id: data.id.toLowerCase() }),
		join(session),
	]);
	assert.deepEqual(first.data, second.data);
	assert.equal(first.data.id, data.id);
	assert.deepEqual((await adminDb.ref(`${room}/members`).get()).val(), {
		[learner.uid]: { email: learnerEmail, joinedAt: first.data.joinedAt },
	});
	assert.deepEqual((await get(view)).val(), {
		title: "Parallel algorithms",
		courseNumber: course.courseNumber,
		semester: course.semester,
	});
	for (const path of [
		room,
		`${room}/members/${learner.uid}`,
		`sessions/${data.id}`,
		"admissions",
		"createOperations",
	]) {
		await assert.rejects(get(ref(learnerDb, path)), /permission.denied/i);
	}
	const other = (
		await create({
			title: "Other lecture",
			operationId: randomUUID(),
			courseId: course.id,
		})
	).data;
	await assert.rejects(
		get(ref(learnerDb, `admissions/${other.id}/live`)),
		/permission.denied/i,
	);
	await adminDb.ref(`admissions/${other.id}/joinExpiresAt`).set(1);
	await assert.rejects(join({ id: other.id }), {
		code: "functions/deadline-exceeded",
	});
	await adminDb.ref(`${room}/joinExpiresAt`).set(1);
	assert.deepEqual((await join(session)).data, first.data);
	await assert.rejects(
		httpsCallable(learnerFunctions, "archiveSession")(session),
		{ code: "functions/permission-denied" },
	);
	await getAdminAuth(admin).setCustomUserClaims(learner.uid, {
		instructor: true,
	});
	await learner.getIdToken(true);
	await assert.rejects(
		httpsCallable(learnerFunctions, "archiveSession")(session),
		{ code: "functions/permission-denied" },
	);
	const active = Promise.withResolvers();
	const revoked = Promise.withResolvers();
	const unsub = onValue(
		view,
		(snapshot) => (snapshot.exists() ? active.resolve() : revoked.resolve()),
		() => revoked.resolve(),
	);
	try {
		await active.promise;
		const archived = await archive(session);
		assert.deepEqual(archived.data, { ...session, state: "archived" });
		assert.deepEqual((await archive(session)).data, archived.data);
		await revoked.promise;
	} finally {
		unsub();
	}
	await assert.rejects(join(session), {
		code: "functions/failed-precondition",
	});
	await assert.rejects(get(view), /permission.denied/i);
	await create(input);
	assert.equal(
		(await get(ref(db, `sessions/${data.id}/state`))).val(),
		"archived",
	);
	assert.equal(
		(
			await get(
				ref(db, `courseLectures/${user.uid}/${course.id}/${data.id}/state`),
			)
		).val(),
		"archived",
	);
	await assert.rejects(get(view), /permission.denied/i);
});

test("only the owner can permanently delete an archived lecture", async () => {
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
	await getAdminAuth(admin).setCustomUserClaims(owner.uid, {
		instructor: true,
	});
	await owner.getIdToken(true);
	const course = await createSyntheticCourse(functions, "DELETE");
	const operationId = randomUUID();
	const { data: session } = await httpsCallable(
		functions,
		"createSession",
	)({
		title: "Disposable synthetic lecture",
		operationId,
		courseId: course.id,
	});
	await adminDb.ref(`reporting/${session.id}/roster`).set({
		revision: 1,
		entries: {
			synthetic: {
				email: "student@example.test",
				canvasIdentifier: "synthetic-1",
			},
		},
	});
	const remove = httpsCallable(functions, "deleteLectureData");
	await assert.rejects(remove({ id: session.id, confirmation: session.id }), {
		code: "functions/failed-precondition",
	});
	await assert.rejects(
		remove({ id: session.id, confirmation: "000000000000" }),
		{ code: "functions/invalid-argument" },
	);

	const otherSub = randomUUID();
	const { user: other } = await signInWithCredential(
		learnerAuth,
		GoogleAuthProvider.credential(
			JSON.stringify({
				sub: otherSub,
				email: `${otherSub}@example.test`,
				email_verified: true,
			}),
		),
	);
	await getAdminAuth(admin).setCustomUserClaims(other.uid, {
		instructor: true,
	});
	await other.getIdToken(true);
	await assert.rejects(
		httpsCallable(
			learnerFunctions,
			"deleteLectureData",
		)({
			id: session.id,
			confirmation: session.id,
		}),
		{ code: "functions/permission-denied" },
	);

	await httpsCallable(functions, "archiveSession")({ id: session.id });
	assert.deepEqual(
		(await remove({ id: session.id, confirmation: session.id })).data,
		{ id: session.id, deleted: true },
	);
	for (const path of [
		`sessions/${session.id}`,
		`admissions/${session.id}`,
		`reporting/${session.id}`,
		`courseLectures/${owner.uid}/${course.id}/${session.id}`,
		`createOperations/${owner.uid}/${operationId}`,
	]) {
		assert.equal((await adminDb.ref(path).get()).exists(), false, path);
	}
	await assert.rejects(remove({ id: session.id, confirmation: session.id }), {
		code: "functions/not-found",
	});
});

test("only lecture owners can manage questions and students see only the ordered live projection", {
	timeout: 30000,
}, async () => {
	const signIn = async (auth) => {
		const sub = randomUUID();
		return (
			await signInWithCredential(
				auth,
				GoogleAuthProvider.credential(
					JSON.stringify({
						sub,
						email: `${sub}@example.test`,
						email_verified: true,
					}),
				),
			)
		).user;
	};
	const [owner, student] = await Promise.all([
		signIn(auth),
		signIn(learnerAuth),
	]);
	await getAdminAuth(admin).setCustomUserClaims(owner.uid, {
		instructor: true,
	});
	await owner.getIdToken(true);
	const course = await createSyntheticCourse(functions, "QUESTIONS-A");
	const otherCourse = await createSyntheticCourse(functions, "QUESTIONS-B");
	const importQuestions = httpsCallable(functions, "importQuestions");
	const short = [
		"ESSAY",
		"",
		"0",
		"Explain the outcome",
		"Private explanation",
		"",
		"",
		"",
		"",
		"",
	];
	const choice = [
		"MC",
		"",
		"1",
		"Which option?",
		"2",
		"One",
		"Two",
		"",
		"",
		"",
	];
	const importId = randomUUID();
	const bank = ref(db, `questionBanks/${course.id}`);
	await assert.rejects(
		importQuestions({
			courseId: course.id,
			operationId: importId,
			rows: [choice, ["SA", ...short.slice(1)]],
		}),
		{ code: "functions/invalid-argument" },
	);
	assert.equal((await get(bank)).exists(), false);
	await assert.rejects(
		httpsCallable(
			learnerFunctions,
			"importQuestions",
		)({
			courseId: course.id,
			operationId: randomUUID(),
			rows: [choice],
		}),
		{ code: "functions/permission-denied" },
	);
	const batch = {
		courseId: course.id,
		operationId: importId,
		rows: [choice, short],
	};
	const [first, retry] = await Promise.all([
		importQuestions(batch),
		importQuestions(batch),
	]);
	assert.deepEqual(retry.data, first.data);
	const [choiceId, shortId] = first.data.ids;
	assert.ok(choiceId && shortId && choiceId !== shortId);
	const createQuestion = httpsCallable(functions, "createQuestion");
	const createdQuestion = {
		type: "short-answer",
		prompt: "Created during class",
		graded: true,
		correctAnswer: "Live answer",
	};
	const createQuestionRequest = {
		courseId: course.id,
		operationId: randomUUID(),
		question: createdQuestion,
	};
	const [created, createdReplay] = await Promise.all([
		createQuestion(createQuestionRequest),
		createQuestion(createQuestionRequest),
	]);
	assert.deepEqual(createdReplay.data, created.data);
	assert.match(created.data.id, /^[0-9a-f-]{36}$/);
	assert.deepEqual(
		(await get(ref(db, `questionBanks/${course.id}/${created.data.id}`))).val(),
		createdQuestion,
	);
	assert.ok(
		Number.isSafeInteger(
			(
				await get(
					ref(
						db,
						`questionBanks/${course.id}/_questionModifiedAt/${created.data.id}`,
					),
				)
			).val(),
		),
	);
	await assert.rejects(
		createQuestion({
			...createQuestionRequest,
			question: { ...createdQuestion, prompt: "Different retry" },
		}),
		{ code: "functions/already-exists" },
	);
	await assert.rejects(
		httpsCallable(learnerFunctions, "createQuestion")(createQuestionRequest),
		{ code: "functions/permission-denied" },
	);
	assert.equal(
		(
			await get(ref(db, `questionBanks/${course.id}/${choiceId}/correctAnswer`))
		).val(),
		"B",
	);
	await assert.rejects(importQuestions({ ...batch, rows: [short] }), {
		code: "functions/already-exists",
	});
	await assert.rejects(
		get(ref(learnerDb, `questionBanks/${course.id}/${choiceId}`)),
		/permission.denied/i,
	);

	const create = httpsCallable(functions, "createSession");
	const {
		data: { id },
	} = await create({
		title: "Question privacy",
		operationId: randomUUID(),
		courseId: course.id,
	});
	const { data: other } = await create({
		title: "Other lecture",
		operationId: randomUUID(),
		courseId: otherCourse.id,
	});
	await httpsCallable(learnerFunctions, "joinSession")({ id });
	const base = `admissions/${id}`;
	const control = ref(db, `${base}/control`);
	const live = ref(learnerDb, `${base}/live`);
	const command = (expectedRevision, operation) => ({
		id,
		expectedRevision,
		operation,
		operationId: randomUUID(),
	});
	const mutate = httpsCallable(functions, "mutateQuestionPlan");
	const run = async (expectedRevision, operation) =>
		(await mutate(command(expectedRevision, operation))).data.revision;
	const liveData = async () => (await get(live)).val()?.questions ?? [];

	const add = command(0, { kind: "add", id: choiceId });
	assert.equal((await mutate(add)).data.revision, 1);
	assert.equal(await run(1, { kind: "add", id: shortId }), 2);
	const updateQuestion = httpsCallable(functions, "updateQuestion");
	const editedChoice = {
		type: "multiple-choice",
		prompt: "Which revised option?",
		graded: true,
		options: ["First", "Second", "Third"],
		correctAnswer: "C",
	};
	const editRequest = {
		courseId: course.id,
		id: choiceId,
		expectedRevision: 0,
		operationId: randomUUID(),
		question: editedChoice,
	};
	const [edited, editReplay] = await Promise.all([
		updateQuestion(editRequest),
		updateQuestion(editRequest),
	]);
	assert.deepEqual(edited.data, { id: choiceId, revision: 1 });
	assert.deepEqual(editReplay.data, edited.data);
	assert.deepEqual(
		(await get(ref(db, `questionBanks/${course.id}/${choiceId}`))).val(),
		editedChoice,
	);
	await assert.rejects(
		updateQuestion({
			...editRequest,
			question: { ...editedChoice, prompt: "Different retry" },
		}),
		{ code: "functions/already-exists" },
	);
	await assert.rejects(
		updateQuestion({
			...editRequest,
			operationId: randomUUID(),
			question: { ...editedChoice, prompt: "Stale edit" },
		}),
		{ code: "functions/aborted" },
	);
	await assert.rejects(
		httpsCallable(
			learnerFunctions,
			"updateQuestion",
		)({
			...editRequest,
			expectedRevision: 1,
			operationId: randomUUID(),
		}),
		{ code: "functions/permission-denied" },
	);
	assert.equal(
		(await get(control)).val().items[0].question.prompt,
		"Which option?",
	);
	await assert.rejects(
		mutate({
			id: other.id,
			expectedRevision: 0,
			operation: { kind: "add", id: choiceId },
			operationId: randomUUID(),
		}),
		{ code: "functions/not-found" },
	);
	assert.equal((await mutate(add)).data.revision, 1);
	assert.equal((await get(control)).val().revision, 2);
	await assert.rejects(
		mutate({ ...add, operation: { kind: "add", id: shortId } }),
		{ code: "functions/already-exists" },
	);
	await assert.rejects(mutate(command(1, { kind: "publish", id: choiceId })), {
		code: "functions/aborted",
	});
	await assert.rejects(mutate(command(2, { kind: "hide", id: choiceId })), {
		code: "functions/failed-precondition",
	});
	assert.deepEqual(await liveData(), []);
	assert.equal((await get(control)).val().items[0].question.correctAnswer, "B");
	await assert.rejects(
		get(ref(learnerDb, `${base}/control`)),
		/permission.denied/i,
	);
	await assert.rejects(
		get(ref(learnerDb, `admissions/${other.id}/live`)),
		/permission.denied/i,
	);

	assert.equal(await run(2, { kind: "publish", id: choiceId }), 3);
	assert.equal(await run(3, { kind: "publish", id: shortId }), 4);
	assert.deepEqual(await liveData(), [
		{
			id: choiceId,
			type: "multiple-choice",
			prompt: "Which option?",
			options: ["One", "Two"],
			graded: true,
		},
		{
			id: shortId,
			type: "short-answer",
			prompt: "Explain the outcome",
			graded: false,
		},
	]);
	assert.equal(await run(4, { kind: "move", id: shortId, by: -1 }), 5);
	assert.deepEqual(
		(await liveData()).map(({ id }) => id),
		[shortId, choiceId],
	);
	assert.equal(await run(5, { kind: "shuffle" }), 6);
	assert.deepEqual(
		(await liveData()).map(({ id }) => id),
		[choiceId, shortId],
	);
	assert.equal(await run(6, { kind: "hide", id: choiceId }), 7);
	assert.equal(await run(7, { kind: "skip", id: shortId }), 8);
	assert.deepEqual(await liveData(), []);
	assert.equal(await run(8, { kind: "restore", id: shortId }), 9);
	assert.equal(await run(9, { kind: "restore", id: choiceId }), 10);
	assert.deepEqual(await liveData(), []);

	const race = await Promise.allSettled([
		mutate(command(10, { kind: "publish", id: choiceId })),
		mutate(command(10, { kind: "publish", id: shortId })),
	]);
	assert.equal(race.filter(({ status }) => status === "fulfilled").length, 1);
	assert.equal(
		race.filter(
			(result) =>
				result.status === "rejected" &&
				result.reason.code === "functions/aborted",
		).length,
		1,
	);
	const [published] = await liveData();
	assert.equal((await liveData()).length, 1);
	await httpsCallable(functions, "deleteQuestion")({
		courseId: course.id,
		id: published.id,
	});
	assert.equal(
		(await get(ref(db, `questionBanks/${course.id}/${published.id}`))).exists(),
		false,
	);
	assert.deepEqual(await liveData(), [published]);
	assert.deepEqual((await importQuestions(batch)).data.ids, first.data.ids);
	assert.equal(
		(await get(ref(db, `questionBanks/${course.id}/${published.id}`))).exists(),
		false,
	);

	await assert.rejects(
		httpsCallable(
			learnerFunctions,
			"mutateQuestionPlan",
		)(command(11, { kind: "shuffle" })),
		{ code: "functions/permission-denied" },
	);
	await getAdminAuth(admin).setCustomUserClaims(student.uid, {
		instructor: true,
	});
	await student.getIdToken(true);
	await assert.rejects(
		httpsCallable(
			learnerFunctions,
			"mutateQuestionPlan",
		)(command(11, { kind: "shuffle" })),
		{ code: "functions/permission-denied" },
	);
	await assert.rejects(
		get(ref(learnerDb, `${base}/control`)),
		/permission.denied/i,
	);
	await assert.rejects(
		get(ref(learnerDb, `questionBanks/${course.id}`)),
		/permission.denied/i,
	);

	const delayed = command(11, {
		kind: "publish",
		id: published.id === choiceId ? shortId : choiceId,
	});
	await httpsCallable(functions, "archiveSession")({ id });
	await assert.rejects(mutate(delayed), {
		code: "functions/failed-precondition",
	});
	assert.equal((await mutate(add)).data.revision, 1);
	await assert.rejects(get(live), /permission.denied/i);
	assert.equal((await get(control)).val().revision, 11);
});

test("answer retries and competing revisions preserve credit and reveal only approved results", {
	timeout: 30000,
}, async () => {
	const signIn = async (auth) => {
		const sub = randomUUID();
		return (
			await signInWithCredential(
				auth,
				GoogleAuthProvider.credential(
					JSON.stringify({
						sub,
						email: `${sub}@example.test`,
						email_verified: true,
					}),
				),
			)
		).user;
	};
	const [owner, student] = await Promise.all([
		signIn(auth),
		signIn(learnerAuth),
	]);
	await getAdminAuth(admin).setCustomUserClaims(owner.uid, {
		instructor: true,
	});
	await owner.getIdToken(true);
	const course = await createSyntheticCourse(functions, "ANSWERS");
	const {
		data: { id },
	} = await httpsCallable(
		functions,
		"createSession",
	)({
		title: "Answer revision and privacy",
		operationId: randomUUID(),
		courseId: course.id,
	});
	const {
		data: {
			ids: [choice, short],
		},
	} = await httpsCallable(
		functions,
		"importQuestions",
	)({
		courseId: course.id,
		operationId: randomUUID(),
		rows: [
			["MC", "", "1", "Which is two?", "2", "One", "Two", "", "", ""],
			["ESSAY", "", "0", "Explain", "A private key", "", "", "", "", ""],
		],
	});
	const activity = (questionId) =>
		`admissions/${id}/questionActivity/${questionId}`;
	const publicStats = `${activity(choice)}/publicStats`;
	const responseParent = `${activity(choice)}/responses/${student.uid}`;
	const studentAnswer = ref(learnerDb, `${responseParent}/accepted`);
	const live = ref(learnerDb, `admissions/${id}/live`);
	const readPublicStats = () => get(ref(learnerDb, publicStats));
	const exposedReveal = async () => (await get(live)).val().reveals?.[choice];
	const denied = (value) => assert.rejects(value, /permission.denied/i);
	const answer = (option) => ({ type: "multiple-choice", option });
	const command = (answer, expectedRevision = 0, questionId = choice) => ({
		id,
		questionId,
		operationId: randomUUID(),
		expectedRevision,
		answer,
	});
	const submit = httpsCallable(learnerFunctions, "submitAnswer");
	const mutate = httpsCallable(functions, "mutateQuestionPlan");
	let revision = 0;
	async function plan(operation) {
		const { data } = await mutate({
			id,
			expectedRevision: revision,
			operationId: randomUUID(),
			operation,
		});
		revision = data.revision;
	}
	const reveal = (target, visible) =>
		plan({ kind: "reveal", id: choice, target, visible });
	const initial = command(answer("A"));
	await assert.rejects(submit(initial), {
		code: "functions/permission-denied",
	});
	await httpsCallable(learnerFunctions, "joinSession")({ id });
	await plan({ kind: "add", id: choice });
	await plan({ kind: "add", id: short });
	await assert.rejects(submit(initial), {
		code: "functions/failed-precondition",
	});
	await plan({ kind: "publish", id: choice });
	await plan({ kind: "publish", id: short });
	await assert.rejects(submit(command(answer("D"))), {
		code: "functions/invalid-argument",
	});
	assert.equal(await exposedReveal(), undefined);
	await denied(readPublicStats());
	const [{ data: first }, { data: concurrent }, { data: shortReceipt }] =
		await Promise.all([
			submit(initial),
			submit(initial),
			submit(
				command(
					{ type: "short-answer", text: "  An individual answer  " },
					0,
					short,
				),
			),
		]);
	assert.deepEqual(concurrent, first);
	assert.equal(first.revision, 1);
	assert.equal(first.participationPoint, 1);
	assert.equal(shortReceipt.revision, 1);
	assert.equal(shortReceipt.participationPoint, 0);
	assert.deepEqual((await get(studentAnswer)).val(), {
		...first,
		answer: answer("A"),
	});
	assert.deepEqual(
		(await get(ref(db, `${activity(short)}/publicStats`))).val(),
		{ type: "short-answer", total: 1 },
	);
	await denied(get(ref(learnerDb, responseParent)));
	await denied(get(ref(learnerDb, `${responseParent}/email`)));
	await denied(get(ref(learnerDb, `${responseParent}/operations`)));
	await denied(get(ref(db, `${responseParent}/accepted`)));
	await denied(get(ref(learnerDb, activity(choice))));
	assert.deepEqual((await get(ref(db, publicStats))).val(), {
		type: "multiple-choice",
		total: 1,
		counts: { A: 1, B: 0 },
	});
	const attempts = await Promise.allSettled([
		submit(command(answer("A"), 1)),
		submit(command(answer("B"), 1)),
	]);
	assert.equal(
		attempts.filter(({ status }) => status === "fulfilled").length,
		1,
	);
	const conflict = attempts.find(({ status }) => status === "rejected");
	assert.equal(conflict.reason.code, "functions/aborted");
	const latest = attempts.find(({ status }) => status === "fulfilled").value
		.data;
	assert.equal(latest.revision, 2);
	assert.equal(latest.participationPoint, 1);
	const { data: final } = await submit(command(answer("B"), 2));
	assert.equal(final.revision, 3);
	assert.equal(final.participationPoint, 1);
	assert.equal(final.firstSubmittedAt, first.firstSubmittedAt);
	assert.deepEqual((await submit(initial)).data, first);
	assert.deepEqual((await get(studentAnswer)).val(), {
		...final,
		answer: answer("B"),
	});

	await reveal("statistics", true);
	assert.deepEqual(await exposedReveal(), { statistics: true });
	assert.deepEqual((await readPublicStats()).val(), {
		type: "multiple-choice",
		total: 1,
		counts: { A: 0, B: 1 },
	});
	await reveal("correctAnswer", true);
	assert.deepEqual(await exposedReveal(), {
		statistics: true,
		correctAnswer: "B",
	});
	async function whileListening(path, change) {
		const active = Promise.withResolvers();
		const revoked = Promise.withResolvers();
		const unsubscribe = onValue(
			path,
			(snapshot) => (snapshot.exists() ? active.resolve() : revoked.resolve()),
			(error) => {
				active.reject(error);
				revoked.resolve();
			},
		);
		try {
			await active.promise;
			await change();
			await revoked.promise;
		} finally {
			unsubscribe();
		}
	}
	await whileListening(ref(learnerDb, publicStats), () =>
		reveal("statistics", false),
	);
	assert.deepEqual(await exposedReveal(), { correctAnswer: "B" });
	await denied(readPublicStats());
	await reveal("statistics", true);
	await plan({ kind: "hide", id: choice });
	assert.equal(await exposedReveal(), undefined);
	await denied(readPublicStats());
	await assert.rejects(submit(command(answer("A"), 3)), {
		code: "functions/failed-precondition",
	});
	await plan({ kind: "publish", id: choice });
	assert.equal(await exposedReveal(), undefined);
	await reveal("statistics", true);
	const overlappingRevision = command(answer("A"), 3);
	const archive = httpsCallable(functions, "archiveSession");
	const archived = Promise.withResolvers();
	await whileListening(studentAnswer, () =>
		whileListening(ref(learnerDb, publicStats), async () => {
			const [revision, closing] = await Promise.allSettled([
				submit(overlappingRevision),
				archive({ id }),
			]);
			assert.equal(closing.status, "fulfilled");
			if (revision.status === "fulfilled") {
				assert.equal(revision.value.data.revision, 4);
				assert.equal(revision.value.data.participationPoint, 1);
				archived.resolve({ ...revision.value.data, answer: answer("A") });
			} else {
				assert.equal(revision.reason.code, "functions/failed-precondition");
				archived.resolve({ ...final, answer: answer("B") });
			}
		}),
	);
	await denied(readPublicStats());
	await denied(get(studentAnswer));
	await denied(get(live));
	assert.equal((await get(ref(db, publicStats))).val().total, 1);
	await assert.rejects(submit(command(answer("A"), 3)), {
		code: "functions/failed-precondition",
	});
	const stored = (await adminDb.ref(`${responseParent}/accepted`).get()).val();
	assert.deepEqual(stored, await archived.promise);
});

test("broadcasts reach joined students while submitted code stays private across revisions and archive", {
	timeout: 30000,
}, async () => {
	async function signIn(auth) {
		const sub = randomUUID();
		return (
			await signInWithCredential(
				auth,
				GoogleAuthProvider.credential(
					JSON.stringify({
						sub,
						email: `${sub}@example.test`,
						email_verified: true,
					}),
				),
			)
		).user;
	}
	const [owner, student] = await Promise.all([
		signIn(auth),
		signIn(learnerAuth),
	]);
	await getAdminAuth(admin).setCustomUserClaims(owner.uid, {
		instructor: true,
	});
	await owner.getIdToken(true);
	const course = await createSyntheticCourse(functions, "BROADCAST");
	const {
		data: { id },
	} = await httpsCallable(
		functions,
		"createSession",
	)({
		title: "Live coding",
		operationId: randomUUID(),
		courseId: course.id,
	});
	const { data: other } = await httpsCallable(
		functions,
		"createSession",
	)({
		title: "Other lecture",
		operationId: randomUUID(),
		courseId: course.id,
	});
	const path = `admissions/${id}`;
	const own = `${path}/codeSubmissions/${student.uid}`;
	const control = `${path}/broadcastControl`;
	const live = ref(learnerDb, `${path}/live`);
	const accepted = ref(learnerDb, `${own}/accepted`);
	const broadcast = httpsCallable(functions, "mutateBroadcast");
	const studentBroadcast = httpsCallable(learnerFunctions, "mutateBroadcast");
	const submit = httpsCallable(learnerFunctions, "submitCode");
	const denied = (promise) => assert.rejects(promise, /permission.denied/i);
	const command = (expectedRevision, command) => ({
		id,
		expectedRevision,
		command,
		operationId: randomUUID(),
	});
	const upload = (
		broadcastRevision,
		expectedRevision = 0,
		content = "  // private code\n",
	) => ({
		id,
		expectedRevision,
		broadcastRevision,
		content,
		operationId: randomUUID(),
	});

	const note = {
		kind: "text",
		content: "Read this\nThen follow along",
		highlightedLines: [2],
	};
	const noteCommand = command(0, { kind: "publish", document: note });
	await assert.rejects(studentBroadcast(noteCommand), {
		code: "functions/permission-denied",
	});
	await assert.rejects(submit(upload(1)), {
		code: "functions/permission-denied",
	});
	await denied(get(live));
	await httpsCallable(learnerFunctions, "joinSession")({ id });
	await denied(get(ref(learnerDb, `admissions/${other.id}/live`)));

	const observed = Promise.withResolvers();
	const unsubscribe = onValue(
		live,
		(snapshot) => {
			const document = snapshot.val()?.broadcast;
			if (document) observed.resolve(document);
		},
		observed.reject,
	);
	try {
		const [first, retry] = await Promise.all([
			broadcast(noteCommand),
			broadcast(noteCommand),
		]);
		assert.deepEqual(first.data, { revision: 1 });
		assert.deepEqual(retry.data, first.data);
		assert.deepEqual(await observed.promise, { ...note, revision: 1 });
	} finally {
		unsubscribe();
	}
	await assert.rejects(submit(upload(1)), {
		code: "functions/failed-precondition",
	});
	await assert.rejects(broadcast(command(0, { kind: "clear" })), {
		code: "functions/aborted",
	});
	await assert.rejects(
		broadcast({ ...noteCommand, command: { kind: "clear" } }),
		{ code: "functions/already-exists" },
	);
	await denied(get(ref(learnerDb, control)));
	await denied(set(ref(learnerDb, `${path}/live/broadcast`), note));

	const code = {
		kind: "code",
		content: "const a = 1;\nconst b = 2;\n",
		language: "javascript",
		highlightedLines: [3, 1, 1],
	};
	const codeResult = await broadcast(
		command(1, { kind: "publish", document: code }),
	);
	assert.deepEqual(codeResult.data, { revision: 2 });
	assert.deepEqual((await get(live)).val().broadcast, {
		...code,
		highlightedLines: [1, 3],
		revision: 2,
	});
	assert.equal((await get(accepted)).exists(), false);
	await assert.rejects(submit(upload(1)), {
		code: "functions/failed-precondition",
	});

	const before = upload(2);
	const [saved, repeated] = await Promise.all([submit(before), submit(before)]);
	assert.deepEqual(saved.data, repeated.data);
	assert.equal(saved.data.revision, 1);
	assert.deepEqual((await get(accepted)).val(), {
		...saved.data,
		content: before.content,
	});
	assert.equal((await adminDb.ref(`${own}/email`).get()).val(), student.email);
	for (const target of [
		`${path}/codeSubmissions`,
		own,
		`${own}/email`,
		`${own}/operations`,
	])
		await denied(get(ref(learnerDb, target)));
	await denied(get(ref(db, `${own}/accepted`)));
	await denied(set(accepted, "replacement"));

	const revisions = await Promise.allSettled([
		submit(upload(2, 1, "A")),
		submit(upload(2, 1, "B")),
	]);
	assert.equal(
		revisions.filter(({ status }) => status === "fulfilled").length,
		1,
	);
	assert.equal(
		revisions.find(({ status }) => status === "rejected").reason.code,
		"functions/aborted",
	);
	assert.equal((await get(accepted)).val().revision, 2);
	assert.deepEqual((await submit(before)).data, saved.data);
	assert.equal((await get(accepted)).val().revision, 2);

	await getAdminAuth(admin).setCustomUserClaims(student.uid, {
		instructor: true,
	});
	await student.getIdToken(true);
	await assert.rejects(studentBroadcast(command(2, { kind: "clear" })), {
		code: "functions/permission-denied",
	});
	const cleared = await broadcast(command(2, { kind: "clear" }));
	assert.equal(cleared.data.revision, 3);
	assert.equal((await get(live)).val().broadcast, undefined);
	await assert.rejects(submit(upload(2, 2)), {
		code: "functions/failed-precondition",
	});
	const fresh = command(3, { kind: "publish", document: code });
	await broadcast(fresh);

	async function revokedAfter(target, change) {
		const ready = Promise.withResolvers();
		const revoked = Promise.withResolvers();
		const stop = onValue(
			target,
			(snapshot) => {
				if (snapshot.exists()) ready.resolve();
				else revoked.resolve();
			},
			(error) => {
				ready.reject(error);
				revoked.resolve();
			},
		);
		try {
			await ready.promise;
			await change();
			await revoked.promise;
		} finally {
			stop();
		}
	}
	const lateBroadcast = command(4, { kind: "publish", document: note });
	await revokedAfter(live, () =>
		revokedAfter(accepted, async () => {
			const [overlap, archive] = await Promise.allSettled([
				broadcast(lateBroadcast),
				httpsCallable(functions, "archiveSession")({ id }),
			]);
			assert.equal(archive.status, "fulfilled");
			if (overlap.status === "rejected")
				assert.equal(overlap.reason.code, "functions/failed-precondition");
		}),
	);
	await denied(get(live));
	await denied(get(accepted));
	await assert.rejects(submit(upload(4, 2)), {
		code: "functions/failed-precondition",
	});
	assert.deepEqual((await broadcast(fresh)).data, { revision: 4 });
	assert.equal((await adminDb.ref(`${path}/live`).get()).exists(), false);
});

test("lecture owners import private rosters and export matched participation after archive", {
	timeout: 30000,
}, async () => {
	async function signIn(target, identity) {
		return (
			await signInWithCredential(
				target,
				GoogleAuthProvider.credential(JSON.stringify(identity)),
			)
		).user;
	}
	const ownerSub = randomUUID();
	const owner = await signIn(auth, {
		sub: ownerSub,
		email: `${ownerSub}@example.test`,
		email_verified: true,
	});
	await getAdminAuth(admin).setCustomUserClaims(owner.uid, {
		instructor: true,
	});
	await owner.getIdToken(true);
	const course = await createSyntheticCourse(functions, "REPORTING");
	const { data: session } = await httpsCallable(
		functions,
		"createSession",
	)({
		title: "Reporting",
		operationId: randomUUID(),
		courseId: course.id,
	});
	const { data: imported } = await httpsCallable(
		functions,
		"importQuestions",
	)({
		courseId: course.id,
		operationId: randomUUID(),
		rows: [["ESSAY", "", "1", "Attendance", "____", "", "", "", "", ""]],
	});
	let planRevision = 0;
	const mutate = httpsCallable(functions, "mutateQuestionPlan");
	for (const operation of [
		{ kind: "add", id: imported.ids[0] },
		{ kind: "publish", id: imported.ids[0] },
	]) {
		const result = await mutate({
			id: session.id,
			expectedRevision: planRevision,
			operationId: randomUUID(),
			operation,
		});
		planRevision = result.data.revision;
	}

	const students = [];
	for (const [name, prefix] of [
		["Alice Example", "alice"],
		["Bob Example", "bob"],
	]) {
		const sub = randomUUID();
		const email = `${prefix}-${sub}@example.test`;
		const user = await signIn(learnerAuth, {
			sub,
			email,
			email_verified: true,
			name,
		});
		await httpsCallable(learnerFunctions, "joinSession")({ id: session.id });
		if (prefix === "alice")
			await httpsCallable(
				learnerFunctions,
				"submitAnswer",
			)({
				id: session.id,
				questionId: imported.ids[0],
				operationId: randomUUID(),
				expectedRevision: 0,
				answer: { type: "short-answer", text: "Present" },
			});
		students.push({ uid: user.uid, email, name });
	}
	assert.equal(
		(
			await adminDb
				.ref(`admissions/${session.id}/members/${students[0].uid}/displayName`)
				.get()
		).val(),
		students[0].name,
	);

	const summary = httpsCallable(functions, "getReportingSummary");
	const roster = httpsCallable(functions, "importRoster");
	const report = httpsCallable(functions, "createReport");
	const rosterRequest = {
		id: session.id,
		expectedRevision: 0,
		operationId: randomUUID(),
		rows: [
			["email", "display_name", "canvas_identifier"],
			[students[0].email, students[0].name, "canvas-1"],
		],
	};
	const currentStatus = (await summary({ id: session.id })).data;
	assert.deepEqual(
		{
			rosterRevision: currentStatus.rosterRevision,
			rosterCount: currentStatus.rosterCount,
			joinedCount: currentStatus.joinedCount,
			participatingCount: currentStatus.participatingCount,
			participationPoints: currentStatus.participationPoints,
		},
		{
			rosterRevision: 0,
			rosterCount: 0,
			joinedCount: 2,
			participatingCount: 1,
			participationPoints: 1,
		},
	);
	assert.ok(
		Number.isSafeInteger(currentStatus.generatedAt) &&
			currentStatus.generatedAt > 0,
	);
	const [saved, replay] = await Promise.all([
		roster(rosterRequest),
		roster(rosterRequest),
	]);
	assert.deepEqual(saved.data, replay.data);
	assert.deepEqual(saved.data, { revision: 1, count: 1 });
	await assert.rejects(
		roster({ ...rosterRequest, operationId: randomUUID() }),
		{ code: "functions/aborted" },
	);
	const participation = (
		await report({
			id: session.id,
			kind: "participation",
		})
	).data;
	assert.equal(participation.rowCount, 2);
	assert.match(participation.csv, /"Alice Example"/);
	assert.match(participation.csv, /"Bob Example"/);
	const canvas = (await report({ id: session.id, kind: "canvas" })).data;
	assert.equal(canvas.rowCount, 1);
	assert.match(canvas.csv, /"canvas-1","1"/);
	assert.deepEqual(canvas.unmatched, [
		{
			email: students[1].email,
			displayName: students[1].name,
			reason: "no-roster-match",
		},
	]);

	await getAdminAuth(admin).setCustomUserClaims(students[1].uid, {
		instructor: true,
	});
	await learnerAuth.currentUser.getIdToken(true);
	await Promise.all(
		[
			httpsCallable(
				learnerFunctions,
				"getReportingSummary",
			)({ id: session.id }),
			httpsCallable(
				learnerFunctions,
				"createReport",
			)({
				id: session.id,
				kind: "participation",
			}),
			httpsCallable(
				learnerFunctions,
				"importRoster",
			)({
				...rosterRequest,
				operationId: randomUUID(),
			}),
		].map((call) =>
			assert.rejects(call, { code: "functions/permission-denied" }),
		),
	);
	await assert.rejects(
		get(ref(db, `reporting/${session.id}`)),
		/permission.denied/i,
	);
	await assert.rejects(
		get(ref(learnerDb, `reporting/${session.id}`)),
		/permission.denied/i,
	);
	await assert.rejects(
		set(ref(db, `reporting/${session.id}/roster/revision`), 99),
		/permission.denied/i,
	);

	await httpsCallable(functions, "archiveSession")({ id: session.id });
	assert.equal(
		(await report({ id: session.id, kind: "participation" })).data.rowCount,
		2,
	);
});
