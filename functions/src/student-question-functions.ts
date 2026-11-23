import { createHash, randomUUID } from "node:crypto";
import type { Database } from "firebase-admin/database";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import type { SessionId } from "./contract.js";
import { admission, authorize, type LectureSession } from "./session.js";
import {
	createStudentQuestion,
	reviewStudentQuestion as reviewStudentQuestionTransition,
	reviseStudentQuestion,
	withdrawStudentQuestion,
} from "./student-question-transitions.js";
import {
	studentQuestionCountLimit,
	studentQuestionId,
	studentQuestionReceiptFor,
	studentQuestionRequest,
	studentQuestionReviewRequest,
	type PublicStudentQuestion,
} from "./student-questions.js";
import { retryContention } from "./transaction.js";

function digest(value: unknown) {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function replacePublicQuestion(
	questions: PublicStudentQuestion[],
	question: PublicStudentQuestion | undefined,
	questionId: string,
) {
	const index = questions.findIndex(({ id }) => id === questionId);
	if (!question) return questions.filter(({ id }) => id !== questionId);
	if (index < 0) return [question, ...questions];
	return questions.map((current, position) =>
		position === index ? question : current,
	);
}

export function studentQuestionCallables({
	db,
	region,
	findSession,
}: {
	db: Database;
	region: string;
	findSession: (id: SessionId) => Promise<LectureSession>;
}) {
	const mutateStudentQuestion = onCall({ region }, async (request) => {
		const actor = authorize(request.auth, false);
		if (actor.kind !== "accepted")
			throw new HttpsError(
				actor.kind,
				"Sign in with a verified Google account.",
			);
		const parsed = studentQuestionRequest.safeParse(request.data);
		if (!parsed.success)
			throw new HttpsError("invalid-argument", "Check the question text.");
		const input = parsed.data;
		const { uid, token } = actor.identity;
		const fingerprint = digest(input);
		const newQuestionId = studentQuestionId.parse(randomUUID());
		let failure:
			| "not-found"
			| "permission-denied"
			| "failed-precondition"
			| "aborted"
			| "invalid-argument"
			| "resource-exhausted"
			| undefined;
		const result = await retryContention(() =>
			db.ref(`admissions/${input.id}`).transaction((current: unknown) => {
				failure = undefined;
				if (current === null) {
					failure = "not-found";
					return current;
				}
				const room = admission.parse(current);
				const operations = room.studentQuestionOperations?.[uid] ?? {};
				if (operations[input.operationId]) return current;
				if (room.state !== "open") {
					failure = "failed-precondition";
					return current;
				}
				if (!Object.hasOwn(room.members ?? {}, uid)) {
					failure = "permission-denied";
					return current;
				}
				const records = room.studentQuestions?.[uid] ?? {};
				if (
					input.kind === "create" &&
					Object.keys(records).length >= studentQuestionCountLimit
				) {
					failure = "resource-exhausted";
					return current;
				}
				const now = Date.now();
				let change: ReturnType<typeof createStudentQuestion>;
				if (input.kind === "create") {
					change = createStudentQuestion({
								questionId: newQuestionId,
								principal: {
									uid,
									email: token.email,
									...(token.name ? { displayName: token.name } : {}),
								},
								text: input.text,
								now,
							});
				} else {
					const previous = records[input.questionId];
					if (!previous) {
						failure = "not-found";
						return current;
					}
					change =
						input.kind === "revise"
							? reviseStudentQuestion({
									record: previous,
									expectedRevision: input.expectedRevision,
									text: input.text,
									now,
								})
							: withdrawStudentQuestion({
									record: previous,
									expectedRevision: input.expectedRevision,
									now,
								});
				}
				if (change.kind !== "accepted") {
					failure = change.kind;
					return current;
				}
				const receipt = studentQuestionReceiptFor(change.record);
				return {
					...room,
					studentQuestions: {
						...room.studentQuestions,
						[uid]: { ...records, [change.record.id]: change.record },
					},
					studentQuestionOperations: {
						...room.studentQuestionOperations,
						[uid]: {
							...operations,
							[input.operationId]: { fingerprint, receipt },
						},
					},
				};
			}),
		);
		if (result.snapshot.exists()) {
			const room = admission.parse(result.snapshot.val());
			const stored = room.studentQuestionOperations?.[uid]?.[input.operationId];
			if (stored) {
				if (stored.fingerprint !== fingerprint)
					throw new HttpsError(
						"already-exists",
						"That request ID already changed a different question.",
					);
				return stored.receipt;
			}
		}
		throw new HttpsError(
			failure ?? "internal",
			failure === "resource-exhausted"
				? `A student can submit at most ${studentQuestionCountLimit} questions per lecture.`
				: "The question could not be changed. Refresh the lecture and try again.",
		);
	});

	const reviewStudentQuestion = onCall({ region }, async (request) => {
		const actor = authorize(request.auth, true);
		if (actor.kind !== "accepted")
			throw new HttpsError(actor.kind, "Sign in as an instructor.");
		const parsed = studentQuestionReviewRequest.safeParse(request.data);
		if (!parsed.success)
			throw new HttpsError("invalid-argument", "Invalid review action.");
		const input = parsed.data;
		const session = await findSession(input.id);
		if (session.instructorUid !== actor.identity.uid)
			throw new HttpsError(
				"permission-denied",
				"Only the lecture owner can review questions.",
			);
		const fingerprint = digest(input);
		let failure: "not-found" | "failed-precondition" | "aborted" | undefined;
		const result = await retryContention(() =>
			db.ref(`admissions/${input.id}`).transaction((current: unknown) => {
				failure = undefined;
				if (current === null) {
					failure = "not-found";
					return current;
				}
				const room = admission.parse(current);
				const uid = actor.identity.uid;
				const operations = room.studentQuestionOperations?.[uid] ?? {};
				if (operations[input.operationId]) return current;
				if (room.state !== "open") {
					failure = "failed-precondition";
					return current;
				}
				const record =
					room.studentQuestions?.[input.studentUid]?.[input.questionId];
				if (!record) {
					failure = "not-found";
					return current;
				}
				const change = reviewStudentQuestionTransition({
					record,
					expectedRevision: input.expectedRevision,
					action: input.action,
					now: Date.now(),
				});
				if (change.kind !== "accepted") {
					failure = change.kind === "invalid-argument" ? "failed-precondition" : change.kind;
					return current;
				}
				const receipt = studentQuestionReceiptFor(change.record);
				return {
					...room,
					studentQuestions: {
						...room.studentQuestions,
						[input.studentUid]: {
							...room.studentQuestions?.[input.studentUid],
							[input.questionId]: change.record,
						},
					},
					live: {
						...room.live,
						studentQuestions: replacePublicQuestion(
							room.live.studentQuestions,
							change.publicQuestion,
							input.questionId,
						),
					},
					studentQuestionOperations: {
						...room.studentQuestionOperations,
						[uid]: {
							...operations,
							[input.operationId]: { fingerprint, receipt },
						},
					},
				};
			}),
		);
		if (result.snapshot.exists()) {
			const room = admission.parse(result.snapshot.val());
			const stored =
				room.studentQuestionOperations?.[actor.identity.uid]?.[
					input.operationId
				];
			if (stored) {
				if (stored.fingerprint !== fingerprint)
					throw new HttpsError(
						"already-exists",
						"That request ID already reviewed a different question.",
					);
				return stored.receipt;
			}
		}
		throw new HttpsError(
			failure ?? "internal",
			"The question could not be reviewed. Refresh the inbox and try again.",
		);
	});

	return { mutateStudentQuestion, reviewStudentQuestion };
}
