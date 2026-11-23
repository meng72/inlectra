import { z } from "zod";
import { codeInput, firebaseUid, operationId } from "./contract.js";

export const studentQuestionLimit = 500;
export const studentQuestionCountLimit = 20;
export const studentQuestionId = z.uuid().brand<"StudentQuestionId">();
export const studentQuestionText = z.string().trim().min(1).max(studentQuestionLimit);
export const studentQuestionReviewState = z.enum([
	"open",
	"answered",
	"dismissed",
	"withdrawn",
]);
export const studentQuestionVisibility = z.enum(["private", "published"]);

export const studentQuestionRecord = z.strictObject({
	id: studentQuestionId,
	authorUid: firebaseUid,
	authorEmail: z.string().min(1),
	authorDisplayName: z.string().min(1).max(200).optional(),
	text: studentQuestionText,
	reviewState: studentQuestionReviewState,
	visibility: studentQuestionVisibility,
	revision: z.number().int().positive(),
	createdAt: z.number().int().nonnegative(),
	updatedAt: z.number().int().nonnegative(),
	publishedAt: z.number().int().nonnegative().optional(),
});
export type StudentQuestionRecord = z.infer<typeof studentQuestionRecord>;

export const publicStudentQuestion = z.strictObject({
	id: studentQuestionId,
	text: studentQuestionText,
	publishedAt: z.number().int().nonnegative(),
	answered: z.boolean(),
});
export type PublicStudentQuestion = z.infer<typeof publicStudentQuestion>;

export const studentQuestionReceipt = z.strictObject({
	questionId: studentQuestionId,
	revision: z.number().int().positive(),
	reviewState: studentQuestionReviewState,
	visibility: studentQuestionVisibility,
	updatedAt: z.number().int().nonnegative(),
});
export type StudentQuestionReceipt = z.infer<typeof studentQuestionReceipt>;

export const studentQuestionRequest = z.discriminatedUnion("kind", [
	z.strictObject({
		kind: z.literal("create"),
		id: codeInput,
		operationId,
		text: studentQuestionText,
	}),
	z.strictObject({
		kind: z.literal("revise"),
		id: codeInput,
		operationId,
		questionId: studentQuestionId,
		expectedRevision: z.number().int().positive(),
		text: studentQuestionText,
	}),
	z.strictObject({
		kind: z.literal("withdraw"),
		id: codeInput,
		operationId,
		questionId: studentQuestionId,
		expectedRevision: z.number().int().positive(),
	}),
]);
export type StudentQuestionRequest = z.infer<typeof studentQuestionRequest>;

export const studentQuestionReviewRequest = z.strictObject({
	id: codeInput,
	operationId,
	studentUid: firebaseUid,
	questionId: studentQuestionId,
	expectedRevision: z.number().int().positive(),
	action: z.enum(["publish", "answer", "dismiss"]),
});
export type StudentQuestionReviewRequest = z.infer<
	typeof studentQuestionReviewRequest
>;

const storedOperation = z.strictObject({
	fingerprint: z.string(),
	receipt: studentQuestionReceipt,
});
export const studentQuestionRecordMap = z.record(
	z.string(),
	studentQuestionRecord,
);
export const studentQuestionRecords = z
	.record(z.string(), studentQuestionRecordMap)
	.optional();
export const studentQuestionOperations = z
	.record(z.string(), z.record(z.string(), storedOperation))
	.optional();

export function studentQuestionReceiptFor(
	record: StudentQuestionRecord,
): StudentQuestionReceipt {
	return {
		questionId: record.id,
		revision: record.revision,
		reviewState: record.reviewState,
		visibility: record.visibility,
		updatedAt: record.updatedAt,
	};
}
