import { z } from "zod";
import { questionActivity } from "./answers.js";
import { broadcastControl, codeSubmission } from "./broadcast.js";
import {
	codeInput,
	courseId,
	firebaseUid,
	operationId,
	ownerSession,
} from "./contract.js";
import { liveQuestions, questionPlan } from "./questions.js";
import {
	studentQuestionOperations,
	studentQuestionRecords,
} from "./student-questions.js";

const identity = z.object({
	uid: firebaseUid,
	token: z.object({
		email: z.string().min(1),
		email_verified: z.literal(true),
		firebase: z.object({ sign_in_provider: z.literal("google.com") }),
		instructor: z.unknown().optional(),
		name: z.string().trim().max(200).optional(),
	}),
});
const creation = z.strictObject({
	title: z.string().trim().min(1).max(120),
	operationId,
	courseId,
});
const reference = z.strictObject({ id: codeInput });
const deletion = z.strictObject({ id: codeInput, confirmation: codeInput });
export const joinWindow = 8 * 60 * 60 * 1000;
export const lectureSession = ownerSession.extend({
	instructorUid: firebaseUid,
	createdAt: z.number(),
	joinExpiresAt: z.number().optional(),
	operationId: operationId.optional(),
});
export type LectureSession = z.infer<typeof lectureSession>;
export const membership = z.object({
	email: z.string(),
	displayName: z.string().min(1).max(200).optional(),
	joinedAt: z.number(),
});
export type Membership = z.infer<typeof membership>;
export const operationReceipt = z.object({
	digest: z.string(),
	revision: z.number().int().positive(),
});
const planOperations = z.record(z.string(), operationReceipt).optional();
const members = z.record(z.string(), membership).optional();
const broadcastFields = {
	broadcastControl: broadcastControl.optional(),
	codeSubmissions: z.record(z.string(), codeSubmission).optional(),
	studentQuestions: studentQuestionRecords,
	studentQuestionOperations,
};
export const admission = z.discriminatedUnion("state", [
	z.object({
		...broadcastFields,
		state: z.literal("open"),
		live: liveQuestions,
		joinExpiresAt: z.number(),
		members,
		control: questionPlan.optional(),
		planOperations,
		questionActivity: z.record(z.string(), questionActivity).optional(),
	}),
	z.looseObject({
		...broadcastFields,
		state: z.literal("archived"),
		members,
		control: questionPlan.optional(),
		planOperations,
		questionActivity: z.record(z.string(), questionActivity).optional(),
	}),
]);

export function authorize(auth: unknown, instructorOnly: boolean) {
	if (auth == null) return { kind: "unauthenticated" } as const;
	const parsed = identity.safeParse(auth);
	if (
		!parsed.success ||
		(instructorOnly && parsed.data.token.instructor !== true)
	) {
		return { kind: "permission-denied" } as const;
	}
	return { kind: "accepted", identity: parsed.data } as const;
}
export function sessionRequest(auth: unknown, data: unknown) {
	const actor = authorize(auth, true);
	if (actor.kind !== "accepted") return actor;
	const input = creation.safeParse(data);
	if (!input.success) return { kind: "invalid-argument" } as const;
	return {
		kind: "accepted",
		instructorUid: actor.identity.uid,
		...input.data,
	} as const;
}
export function accessRequest(
	auth: unknown,
	data: unknown,
	action: "join" | "archive",
) {
	const actor = authorize(auth, action === "archive");
	if (actor.kind !== "accepted") return actor;
	const input = reference.safeParse(data);
	if (!input.success) return { kind: "invalid-argument" } as const;
	return {
		kind: "accepted",
		id: input.data.id,
		uid: actor.identity.uid,
		email: actor.identity.token.email,
		...(actor.identity.token.name
			? { displayName: actor.identity.token.name }
			: {}),
	} as const;
}
export function deletionRequest(auth: unknown, data: unknown) {
	const actor = authorize(auth, true);
	if (actor.kind !== "accepted") return actor;
	const input = deletion.safeParse(data);
	if (!input.success || input.data.confirmation !== input.data.id)
		return { kind: "invalid-argument" } as const;
	return {
		kind: "accepted",
		id: input.data.id,
		uid: actor.identity.uid,
	} as const;
}
export function joinDecision(
	room: z.infer<typeof admission>,
	uid: string,
	now: number,
) {
	if (room.state === "archived") return "closed";
	if (Object.hasOwn(room.members ?? {}, uid)) return "member";
	return now < room.joinExpiresAt ? "admit" : "expired";
}
