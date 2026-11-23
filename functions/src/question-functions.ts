import { createHash, randomInt, randomUUID } from "node:crypto";
import type { Database } from "firebase-admin/database";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import { courseId, type Course, type CourseId, type SessionId } from "./contract.js";
import { changeQuestionPlan } from "./question-plan.js";
import {
	availableQuestions,
	createQuestionReceipt,
	createQuestionRequest,
	emptyPlan,
	importReceipt,
	importRequest,
	planRequest,
	questionContent,
	questionId,
	questionModifiedAtMap,
	questionRevisionMap,
	questionReveals,
	updateQuestionReceipt,
	updateQuestionRequest,
	validateQuestionRows,
} from "./questions.js";
import { admission, authorize, type LectureSession } from "./session.js";

const bankState = z.looseObject({
	_imports: z
		.record(z.string(), importReceipt.extend({ digest: z.string() }))
		.optional(),
	_questionRevisions: questionRevisionMap.optional(),
	_questionModifiedAt: questionModifiedAtMap.optional(),
	_questionCreations: z
		.record(z.string(), createQuestionReceipt.extend({ digest: z.string() }))
		.optional(),
	_questionUpdates: z
		.record(z.string(), updateQuestionReceipt.extend({ digest: z.string() }))
		.optional(),
});
const deleteRequest = z.strictObject({
	courseId,
	id: questionId,
});

function instructorUid(auth: unknown) {
	const actor = authorize(auth, true);
	if (actor.kind !== "accepted") {
		throw new HttpsError(actor.kind, "Sign in with an instructor account.");
	}
	return actor.identity.uid;
}

function digest(value: unknown) {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function questionCallables({
	db,
	region,
	findSession,
	findOwnedCourse,
	openAdmission,
}: {
	db: Database;
	region: string;
	findSession: (id: SessionId) => Promise<LectureSession>;
	findOwnedCourse: (uid: string, id: CourseId) => Promise<Course>;
	openAdmission: (session: LectureSession) => unknown;
}) {
	const importQuestions = onCall({ region }, async (request) => {
		const uid = instructorUid(request.auth);
		const input = importRequest.safeParse(request.data);
		if (!input.success)
			throw new HttpsError("invalid-argument", "Invalid import request.");
		await findOwnedCourse(uid, input.data.courseId);
		const data = validateQuestionRows(input.data.rows);
		if (!data.ok)
			throw new HttpsError(
				"invalid-argument",
				"Correct the records before importing.",
				data.errors,
			);
		const op = input.data.operationId;
		const fingerprint = digest(data.questions);
		const ids = data.questions.map(() => questionId.parse(randomUUID()));
		const importedAt = Date.now();
		const records = Object.fromEntries(
			ids.map((id, index) => [id, data.questions[index]]),
		);
		const modifiedAt = Object.fromEntries(
			ids.map((id, index) => [id, importedAt - index]),
		);
		const written = await db
			.ref(`questionBanks/${input.data.courseId}`)
			.transaction((current: unknown) => {
				const bank = bankState.parse(current ?? {});
				if (bank._imports?.[op]) return current;
				return {
					...bank,
					...records,
					_questionModifiedAt: {
						...bank._questionModifiedAt,
						...modifiedAt,
					},
					_imports: { ...bank._imports, [op]: { digest: fingerprint, ids } },
				};
			});
		const receipt = bankState.parse(written.snapshot.val())._imports?.[op];
		if (!receipt) throw new HttpsError("internal", "Import receipt missing.");
		if (receipt.digest !== fingerprint) {
			throw new HttpsError(
				"already-exists",
				"That operation imported different questions.",
			);
		}
		return { ids: receipt.ids };
	});

	const createQuestion = onCall({ region }, async (request) => {
		const uid = instructorUid(request.auth);
		const input = createQuestionRequest.safeParse(request.data);
		if (!input.success)
			throw new HttpsError("invalid-argument", "Invalid question.");
		await findOwnedCourse(uid, input.data.courseId);
		const { courseId, operationId, question } = input.data;
		const fingerprint = digest(question);
		const id = questionId.parse(randomUUID());
		const modifiedAt = Date.now();
		const written = await db
			.ref(`questionBanks/${courseId}`)
			.transaction((current: unknown) => {
				const bank = bankState.parse(current ?? {});
				if (bank._questionCreations?.[operationId]) return current;
				return {
					...bank,
					[id]: question,
					_questionModifiedAt: {
						...bank._questionModifiedAt,
						[id]: modifiedAt,
					},
					_questionCreations: {
						...bank._questionCreations,
						[operationId]: { id, digest: fingerprint },
					},
				};
			});
		const receipt = bankState.parse(written.snapshot.val())
			._questionCreations?.[operationId];
		if (!receipt)
			throw new HttpsError("internal", "Question creation receipt missing.");
		if (receipt.digest !== fingerprint)
			throw new HttpsError(
				"already-exists",
				"That operation created a different question.",
			);
		return { id: receipt.id };
	});

	const updateQuestion = onCall({ region }, async (request) => {
		const uid = instructorUid(request.auth);
		const input = updateQuestionRequest.safeParse(request.data);
		if (!input.success)
			throw new HttpsError("invalid-argument", "Invalid question update.");
		await findOwnedCourse(uid, input.data.courseId);
		const { courseId, id, expectedRevision, operationId, question } = input.data;
		const fingerprint = digest([id, expectedRevision, question]);
		const modifiedAt = Date.now();
		let failure: "missing" | "stale" | undefined;
		const written = await db
			.ref(`questionBanks/${courseId}`)
			.transaction((current: unknown) => {
				const bank = bankState.parse(current ?? {});
				failure = undefined;
				if (bank._questionUpdates?.[operationId]) return current;
				if (!questionContent.safeParse(bank[id]).success) {
					failure = "missing";
					return current;
				}
				const revision = bank._questionRevisions?.[id] ?? 0;
				if (revision !== expectedRevision) {
					failure = "stale";
					return current;
				}
				const nextRevision = revision + 1;
				return {
					...bank,
					[id]: question,
					_questionRevisions: {
						...bank._questionRevisions,
						[id]: nextRevision,
					},
					_questionModifiedAt: {
						...bank._questionModifiedAt,
						[id]: modifiedAt,
					},
					_questionUpdates: {
						...bank._questionUpdates,
						[operationId]: {
							id,
							digest: fingerprint,
							revision: nextRevision,
						},
					},
				};
			});
		const receipt = bankState.parse(written.snapshot.val())._questionUpdates?.[
			operationId
		];
		if (receipt) {
			if (receipt.id !== id || receipt.digest !== fingerprint) {
				throw new HttpsError(
					"already-exists",
					"That operation updated a different question.",
				);
			}
			return { id: receipt.id, revision: receipt.revision };
		}
		if (failure === "missing")
			throw new HttpsError("not-found", "The question is unavailable.");
		if (failure === "stale")
			throw new HttpsError("aborted", "The question changed. Try again.");
		throw new HttpsError("internal", "Question update receipt missing.");
	});

	const deleteQuestion = onCall({ region }, async (request) => {
		const uid = instructorUid(request.auth);
		const input = deleteRequest.safeParse(request.data);
		if (!input.success)
			throw new HttpsError("invalid-argument", "Invalid question ID.");
		await findOwnedCourse(uid, input.data.courseId);
		await db
			.ref(`questionBanks/${input.data.courseId}`)
			.transaction((current: unknown) => {
			const bank = bankState.parse(current ?? {});
			const next = { ...bank };
			delete next[input.data.id];
			const revisions = { ...bank._questionRevisions };
			delete revisions[input.data.id];
			if (Object.keys(revisions).length > 0)
				next._questionRevisions = revisions;
			else delete next._questionRevisions;
			const modifiedAt = { ...bank._questionModifiedAt };
			delete modifiedAt[input.data.id];
			if (Object.keys(modifiedAt).length > 0)
				next._questionModifiedAt = modifiedAt;
			else delete next._questionModifiedAt;
			return next;
			});
		return { id: input.data.id };
	});

	const mutateQuestionPlan = onCall({ region }, async (request) => {
		const uid = instructorUid(request.auth);
		const input = planRequest.safeParse(request.data);
		if (!input.success)
			throw new HttpsError("invalid-argument", "Invalid plan command.");
		const { id, operation, operationId, expectedRevision } = input.data;
		const session = await findSession(id);
		if (session.instructorUid !== uid) {
			throw new HttpsError(
				"permission-denied",
				"Only the lecture owner can manage its plan.",
			);
		}
		const question =
			operation.kind === "add"
				? questionContent.safeParse(
						(
							await db
								.ref(`questionBanks/${session.courseId}/${operation.id}`)
								.get()
						).val(),
					).data
				: undefined;
		const fingerprint = digest([expectedRevision, operation]);
		let failure:
			| "archived"
			| "stale"
			| "invalid"
			| "missing-question"
			| undefined;
		const written = await db
			.ref(`admissions/${id}`)
			.transaction((current: unknown) => {
				const room = admission.parse(
					current ??
						(session.state === "archived"
							? { state: "archived" }
							: openAdmission(session)),
				);
				failure = undefined;
				if (room.planOperations?.[operationId]) return current;
				if (room.state === "archived") {
					failure = "archived";
					return current;
				}
				const change = changeQuestionPlan({
					state: room.state,
					plan: room.control ?? emptyPlan,
					expectedRevision,
					operation,
					question,
					randomIndex: randomInt,
				});
				if (change.kind !== "applied") {
					failure = change.kind;
					return current;
				}
				const plan = change.plan;
				return {
					...room,
					control: plan,
					live: {
						...room.live,
						questions: availableQuestions(plan),
						reveals: questionReveals(plan),
					},
					planOperations: {
						...room.planOperations,
						[operationId]: { digest: fingerprint, revision: plan.revision },
					},
				};
			});
		const room = admission.parse(
			written.snapshot.val() ??
				(session.state === "archived"
					? { state: "archived" }
					: openAdmission(session)),
		);
		const receipt = room.planOperations?.[operationId];
		if (receipt) {
			if (receipt.digest !== fingerprint) {
				throw new HttpsError(
					"already-exists",
					"That operation used a different plan command.",
				);
			}
			return { revision: receipt.revision };
		}
		if (failure === "archived" || room.state === "archived")
			throw new HttpsError(
				"failed-precondition",
				"The lecture has been archived.",
			);
		if (failure === "stale")
			throw new HttpsError("aborted", "The lecture plan changed. Try again.");
		if (failure === "missing-question")
			throw new HttpsError("not-found", "The question is unavailable.");
		if (failure === "invalid")
			throw new HttpsError(
				"failed-precondition",
				"That action is unavailable.",
			);
		throw new HttpsError("internal", "Plan receipt missing.");
	});

	return {
		importQuestions,
		createQuestion,
		updateQuestion,
		deleteQuestion,
		mutateQuestionPlan,
	};
}
