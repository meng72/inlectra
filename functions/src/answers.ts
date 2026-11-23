import { z } from "zod";
import { codeInput, operationId } from "./contract.js";
import { optionLetter, optionLetters, questionId } from "./questions.js";

export const shortAnswerLimit = 2000;
const multipleResponseOptions = z
	.array(optionLetter)
	.min(1)
	.max(5)
	.refine((options) => new Set(options).size === options.length, {
		message: "Choose each option once.",
	})
	.transform((options) =>
		optionLetters.filter((option) => options.includes(option)),
	);
export const answer = z.discriminatedUnion("type", [
	z.strictObject({ type: z.literal("multiple-choice"), option: optionLetter }),
	z.strictObject({
		type: z.literal("multiple-response"),
		options: multipleResponseOptions,
	}),
	z.strictObject({
		type: z.literal("numeric"),
		value: z
			.string()
			.trim()
			.regex(/^-?(?:\d+(?:\.\d+)?|\.\d+)$/),
	}),
	z.strictObject({
		type: z.literal("short-answer"),
		text: z.string().trim().min(1).max(shortAnswerLimit),
	}),
]);
export type Answer = z.infer<typeof answer>;

export const submissionRequest = z.strictObject({
	id: codeInput,
	questionId,
	operationId,
	expectedRevision: z.number().int().nonnegative(),
	answer,
});
export type SubmissionRequest = z.infer<typeof submissionRequest>;

export const submissionReceipt = z.strictObject({
	revision: z.number().int().positive(),
	participationPoint: z.union([z.literal(0), z.literal(1)]),
	firstSubmittedAt: z.number(),
	updatedAt: z.number(),
});
export const acceptedResponse = submissionReceipt.extend({ answer });
export type AcceptedResponse = z.infer<typeof acceptedResponse>;

const submissionCount = z.number().int().nonnegative();
export const questionStats = z.discriminatedUnion("type", [
	z.strictObject({
		type: z.literal("multiple-choice"),
		total: submissionCount,
		counts: z.partialRecord(optionLetter, submissionCount),
	}),
	z.strictObject({
		type: z.literal("multiple-response"),
		total: submissionCount,
		counts: z.partialRecord(optionLetter, submissionCount),
	}),
	z.strictObject({ type: z.literal("numeric"), total: submissionCount }),
	z.strictObject({ type: z.literal("short-answer"), total: submissionCount }),
]);
export type QuestionStats = z.infer<typeof questionStats>;

const response = z.strictObject({
	accepted: acceptedResponse,
	email: z.string().min(1),
	operations: z.record(
		z.string(),
		z.strictObject({ fingerprint: z.string(), receipt: submissionReceipt }),
	),
});
export const questionActivity = z.strictObject({
	responses: z.record(z.string(), response),
	publicStats: questionStats,
});
export type QuestionActivity = z.infer<typeof questionActivity>;
