import { createHash } from "node:crypto";
import type { Database } from "firebase-admin/database";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { decideSubmission } from "./answer-submission.js";
import { submissionRequest } from "./answers.js";
import { admission, authorize } from "./session.js";
import { retryContention } from "./transaction.js";

export function answerCallable(db: Database, region: string) {
	return onCall({ region }, async (request) => {
		const actor = authorize(request.auth, false);
		if (actor.kind !== "accepted") {
			throw new HttpsError(
				actor.kind,
				"Sign in with a verified Google account.",
			);
		}
		const input = submissionRequest.safeParse(request.data);
		if (!input.success)
			throw new HttpsError("invalid-argument", "Invalid answer request.");
		const { id, questionId, expectedRevision, answer } = input.data;
		const { uid, token } = actor.identity;
		const fingerprint = createHash("sha256")
			.update(JSON.stringify([expectedRevision, answer]))
			.digest("hex");
		const now = Date.now();
		const roomRef = db.ref(`admissions/${id}`);
		const result = await retryContention(() =>
			roomRef.transaction((current: unknown) => {
				if (current === null) return current;
				const room = admission.parse(current);
				if (room.state === "archived") return current;
				const decision = decideSubmission({
					activity: room.questionActivity?.[questionId],
					item: room.control?.items.find(({ id }) => id === questionId),
					member: Object.hasOwn(room.members ?? {}, uid),
					principal: { uid, email: token.email },
					request: input.data,
					fingerprint,
					now,
				});
				if (decision.kind !== "accepted") return current;
				return {
					...room,
					questionActivity: {
						...room.questionActivity,
						[questionId]: decision.activity,
					},
				};
			}),
		);
		if (!result.snapshot.exists()) {
			throw new HttpsError("not-found", "The lecture is unavailable.");
		}
		const room = admission.parse(result.snapshot.val());
		const activity = room.questionActivity?.[questionId];
		const prior = activity?.responses;
		const receipt =
			prior && Object.hasOwn(prior, uid)
				? prior[uid].operations[input.data.operationId]
				: undefined;
		if (receipt) {
			if (receipt.fingerprint !== fingerprint) {
				throw new HttpsError(
					"already-exists",
					"This request ID already saved a different answer.",
				);
			}
			return receipt.receipt;
		}
		if (room.state === "archived") {
			throw new HttpsError(
				"failed-precondition",
				"The lecture has been archived.",
			);
		}
		const decision = decideSubmission({
			activity,
			item: room.control?.items.find(({ id }) => id === questionId),
			member: Object.hasOwn(room.members ?? {}, uid),
			principal: { uid, email: token.email },
			request: input.data,
			fingerprint,
			now,
		});
		switch (decision.kind) {
			case "permission-denied":
				throw new HttpsError(
					decision.kind,
					"Join the lecture before submitting.",
				);
			case "failed-precondition":
				throw new HttpsError(decision.kind, "This question is unavailable.");
			case "aborted":
				throw new HttpsError(
					decision.kind,
					"An answer was saved with a newer revision.",
				);
			case "invalid-argument":
				throw new HttpsError(
					decision.kind,
					"Choose a valid answer for this question.",
				);
			default:
				throw new HttpsError("internal", "Submission receipt missing.");
		}
	});
}
