import { randomBytes } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getDatabase, getDatabaseWithUrl } from "firebase-admin/database";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import { answerCallable } from "./answer-functions.js";
import { broadcastCallables } from "./broadcast-functions.js";
import {
	courseId,
	courseLectureSummary,
	courseNumber,
	semester,
	sessionId,
	type SessionId,
} from "./contract.js";
import { courseCallables } from "./course-functions.js";
import { questionCallables } from "./question-functions.js";
import { reportCallables } from "./report-functions.js";
import {
	accessRequest,
	admission,
	deletionRequest,
	joinDecision,
	joinWindow,
	lectureSession,
	type LectureSession,
	sessionRequest,
} from "./session.js";
import { retryContention } from "./transaction.js";
import { studentQuestionCallables } from "./student-question-functions.js";

const app = initializeApp();
const db =
	process.env.FUNCTIONS_EMULATOR === "true"
		? getDatabaseWithUrl(
				"https://demo-inlectra-default-rtdb.firebaseio.com",
				app,
			)
		: getDatabase(app);
const region = "us-central1";
const reservation = z.object({
	id: sessionId,
	title: z.string(),
	courseId,
	courseNumber,
	semester,
	createdAt: z.number(),
});
const newId = () =>
	sessionId.parse(randomBytes(6).toString("hex").toUpperCase());

function reject(
	kind: "unauthenticated" | "permission-denied" | "invalid-argument",
): never {
	const messages = {
		unauthenticated: "Sign in with Google.",
		"permission-denied": "Your account does not have access.",
		"invalid-argument":
			"Check the lecture title or session code and try again.",
	};
	throw new HttpsError(kind, messages[kind]);
}

async function findSession(id: SessionId) {
	const snapshot = await db.ref(`sessions/${id}`).get();
	if (!snapshot.exists())
		throw new HttpsError("not-found", "No lecture has that code.");
	return lectureSession.parse(snapshot.val());
}
function openAdmission(session: LectureSession) {
	return {
		state: "open",
		live: {
			title: session.title,
			courseNumber: session.courseNumber,
			semester: session.semester,
		},
		joinExpiresAt: session.joinExpiresAt ?? session.createdAt + joinWindow,
	};
}

export const { createCourse, findOwnedCourse } = courseCallables({ db, region });
export const {
	importQuestions,
	createQuestion,
	updateQuestion,
	deleteQuestion,
	mutateQuestionPlan,
} = questionCallables({
	db,
	region,
	findSession,
	findOwnedCourse,
	openAdmission,
});
export const submitAnswer = answerCallable(db, region);
export const { mutateBroadcast, submitCode } = broadcastCallables({
	db,
	region,
	findSession,
	openAdmission,
});
export const { importRoster, getReportingSummary, createReport } =
	reportCallables({ db, region, findSession });
export const { mutateStudentQuestion, reviewStudentQuestion } =
	studentQuestionCallables({ db, region, findSession });

export const createSession = onCall({ region }, async (request) => {
	const input = sessionRequest(request.auth, request.data);
	if (input.kind !== "accepted") return reject(input.kind);
	const { instructorUid, title, operationId, courseId } = input;
	const ownedCourse = await findOwnedCourse(instructorUid, courseId);
	const slot = db.ref(`createOperations/${instructorUid}/${operationId}`);
	let collided: SessionId | undefined;
	for (let attempt = 0; attempt < 5; attempt++) {
		const candidate = {
			id: newId(),
			title,
			courseId,
			courseNumber: ownedCourse.courseNumber,
			semester: ownedCourse.semester,
			createdAt: Date.now(),
		};
		const reserved = await slot.transaction((current) => {
			if (current === null) return candidate;
			const existing = reservation.parse(current);
			return existing.title === title &&
				existing.courseId === courseId &&
				existing.id === collided
				? candidate
				: current;
		});
		const chosen = reservation.parse(reserved.snapshot.val());
		if (chosen.title !== title || chosen.courseId !== courseId)
			throw new HttpsError(
				"already-exists",
				"This request already created a different lecture.",
			);
		const session: LectureSession = {
			...chosen,
			instructorUid,
			operationId,
			joinCode: chosen.id,
			joinExpiresAt: chosen.createdAt + joinWindow,
			state: "open",
		};
		const saved = await db
			.ref(`sessions/${chosen.id}`)
			.transaction((current) => current ?? session);
		const stored = lectureSession.parse(saved.snapshot.val());
		if (
			stored.instructorUid !== instructorUid ||
			stored.operationId !== operationId
		) {
			collided = chosen.id;
			continue;
		}
		if (stored.state === "open") {
			await db
				.ref(`admissions/${stored.id}`)
				.transaction((current) => current ?? openAdmission(stored));
		}
		await db
			.ref(`courseLectures/${instructorUid}/${stored.courseId}/${stored.id}`)
			.transaction(
				(current) =>
					current ??
					courseLectureSummary.parse({
						id: stored.id,
						joinCode: stored.joinCode,
						title: stored.title,
						courseId: stored.courseId,
						courseNumber: stored.courseNumber,
						semester: stored.semester,
						state: stored.state,
						createdAt: stored.createdAt,
					}),
			);
		return {
			id: stored.id,
			joinCode: stored.joinCode,
			title: stored.title,
			courseId: stored.courseId,
			courseNumber: stored.courseNumber,
			semester: stored.semester,
		};
	}
	throw new HttpsError(
		"unavailable",
		"Could not assign a session code. Retry creation.",
	);
});

export const joinSession = onCall({ region }, async (request) => {
	const input = accessRequest(request.auth, request.data, "join");
	if (input.kind !== "accepted") return reject(input.kind);
	const { uid, id, email } = input;
	const session = await findSession(id);
	if (session.state === "archived")
		throw new HttpsError(
			"failed-precondition",
			"The lecture has been archived.",
		);
	const roomRef = db.ref(`admissions/${id}`);
	const result = await retryContention(() =>
		roomRef.transaction((current) => {
			const room = admission.parse(current ?? openAdmission(session));
			const now = Date.now();
			if (room.state !== "open" || joinDecision(room, uid, now) !== "admit")
				return current;
			return {
				...(current ?? room),
				members: {
					...current?.members,
					[uid]: {
						email,
						...(input.displayName ? { displayName: input.displayName } : {}),
						joinedAt: now,
					},
				},
			};
		}),
	);
	const room = admission.parse(result.snapshot.val() ?? openAdmission(session));
	if (room.state === "archived")
		throw new HttpsError(
			"failed-precondition",
			"The lecture has been archived.",
		);
	if (!room.members || !Object.hasOwn(room.members, uid))
		throw new HttpsError("deadline-exceeded", "The join window has expired.");
	return { id, joinedAt: room.members[uid].joinedAt };
});

export const archiveSession = onCall({ region }, async (request) => {
	const input = accessRequest(request.auth, request.data, "archive");
	if (input.kind !== "accepted") return reject(input.kind);
	const session = await findSession(input.id);
	if (session.instructorUid !== input.uid) return reject("permission-denied");
	await db.ref().update({
		[`sessions/${input.id}/state`]: "archived",
		[`courseLectures/${input.uid}/${session.courseId}/${input.id}/state`]:
			"archived",
		[`admissions/${input.id}/state`]: "archived",
		[`admissions/${input.id}/live`]: null,
	});
	return { id: input.id, state: "archived" };
});

export const deleteLectureData = onCall({ region }, async (request) => {
	const input = deletionRequest(request.auth, request.data);
	if (input.kind !== "accepted") return reject(input.kind);
	const session = await findSession(input.id);
	if (session.instructorUid !== input.uid) return reject("permission-denied");
	if (session.state !== "archived")
		throw new HttpsError(
			"failed-precondition",
			"Archive the lecture before deleting its data.",
		);
	await db.ref().update({
		[`sessions/${input.id}`]: null,
		[`admissions/${input.id}`]: null,
		[`reporting/${input.id}`]: null,
		[`courseLectures/${input.uid}/${session.courseId}/${input.id}`]: null,
		...(session.operationId
			? { [`createOperations/${input.uid}/${session.operationId}`]: null }
			: {}),
	});
	return { id: input.id, deleted: true };
});
