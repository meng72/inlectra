import { z } from "zod";
import { broadcastDocument } from "./broadcast.js";
import {
	codeInput,
	courseId,
	courseNumber,
	operationId,
	semester,
} from "./contract.js";
import { publicStudentQuestion } from "./student-questions.js";

export const csvHeaders = [
	"Type",
	"Title",
	"Points",
	"Question",
	"Answer",
	"Choice1",
	"Choice2",
	"Choice3",
	"Choice4",
	"Choice5",
] as const;
export const maxImportRows = 100;
export const questionId = z.uuid().brand<"QuestionId">();
export type QuestionId = z.infer<typeof questionId>;
export const optionLetters = ["A", "B", "C", "D", "E"] as const;
export const optionLetter = z.enum(optionLetters);
const prompt = z.string().trim().min(1).max(2000);
const option = z.string().trim().min(1).max(200);
const options = z.union([
	z.tuple([option, option]),
	z.tuple([option, option, option]),
	z.tuple([option, option, option, option]),
	z.tuple([option, option, option, option, option]),
]);
const common = { prompt, graded: z.boolean() };
const publicChoice = z.strictObject({
	...common,
	id: questionId,
	type: z.literal("multiple-choice"),
	options,
});
const publicResponse = z.strictObject({
	...common,
	id: questionId,
	type: z.literal("multiple-response"),
	options,
});
const publicShort = z.strictObject({
	...common,
	id: questionId,
	type: z.literal("short-answer"),
});
const publicNumeric = z.strictObject({
	...common,
	id: questionId,
	type: z.literal("numeric"),
});
export const publicQuestion = z.discriminatedUnion("type", [
	publicChoice,
	publicResponse,
	publicNumeric,
	publicShort,
]);
export type PublicQuestion = z.infer<typeof publicQuestion>;
const choice = publicChoice
	.omit({ id: true })
	.extend({ correctAnswer: optionLetter });
const response = publicResponse.omit({ id: true }).extend({
	correctAnswer: z.string().regex(/^[A-E](?:, [A-E])*$/),
});
const short = publicShort.omit({ id: true }).extend({
	correctAnswer: z.string().trim().max(500),
});
const numeric = publicNumeric.omit({ id: true }).extend({
	correctAnswer: z
		.string()
		.trim()
		.regex(/^-?(?:\d+(?:\.\d+)?|\.\d+)$/),
});
export const questionContent = z
	.discriminatedUnion("type", [choice, response, numeric, short])
	.superRefine((value, context) => {
		if (
			value.type === "multiple-choice" &&
			optionLetters.indexOf(value.correctAnswer) >= value.options.length
		) {
			context.addIssue({
				code: "custom",
				path: ["correctAnswer"],
				message: "Correct answer must name an existing option (A–E).",
			});
		}
		if (value.type === "multiple-response") {
			const answers = value.correctAnswer.split(", ");
			if (
				new Set(answers).size !== answers.length ||
				answers.some((answer) => {
					const parsed = optionLetter.safeParse(answer);
					return (
						!parsed.success ||
						optionLetters.indexOf(parsed.data) >= value.options.length
					);
				})
			) {
				context.addIssue({
					code: "custom",
					path: ["correctAnswer"],
					message: "Correct answers must name distinct existing options.",
				});
			}
		}
	});
export type QuestionContent = z.infer<typeof questionContent>;

export function studentQuestion(
	id: QuestionId,
	question: QuestionContent,
): PublicQuestion {
	const { prompt, graded } = question;
	return question.type === "multiple-choice" ||
		question.type === "multiple-response"
		? { id, prompt, graded, type: question.type, options: question.options }
		: { id, prompt, graded, type: question.type };
}

const saaPoints = z
	.string()
	.trim()
	.regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/, "Use a nonnegative number.")
	.transform(Number);
const saaCsvRow = z.array(z.string().trim()).length(csvHeaders.length);
const saaCsvRecord = z
	.tuple([
		z.enum(["MC", "MR", "TF", "NUM", "ESSAY"], {
			error: "Choose MC, MR, TF, NUM, or ESSAY.",
		}),
		z.string().trim().max(200),
		saaPoints,
		prompt,
		z.string().trim().max(500),
		z.string().trim().max(200),
		z.string().trim().max(200),
		z.string().trim().max(200),
		z.string().trim().max(200),
		z.string().trim().max(200),
	])
	.transform(
		([type, _title, points, prompt, answer, ...choiceFields], context) => {
			const graded = points > 0;
			if (type === "NUM" || type === "ESSAY") {
				if (choiceFields.some(Boolean)) {
					context.addIssue({
						code: "custom",
						message: `Leave choices blank for ${type}.`,
					});
					return z.NEVER;
				}
				if (type === "NUM" && !/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(answer)) {
					context.addIssue({
						code: "custom",
						message: "Answer must be a number for NUM.",
					});
					return z.NEVER;
				}
				return type === "NUM"
					? { type: "numeric", prompt, correctAnswer: answer, graded }
					: {
							type: "short-answer",
							prompt,
							correctAnswer: answer === "____" ? "" : answer,
							graded,
						};
			}
			const lastChoice = choiceFields.reduce(
				(last, choice, index) => (choice ? index : last),
				-1,
			);
			if (
				lastChoice < 1 ||
				choiceFields.slice(0, lastChoice + 1).some((choice) => !choice)
			) {
				context.addIssue({
					code: "custom",
					message:
						"Supply contiguous choices starting with Choice1 and Choice2.",
				});
				return z.NEVER;
			}
			if (
				type === "TF" &&
				(lastChoice !== 1 ||
					choiceFields[0] !== "TRUE" ||
					choiceFields[1] !== "FALSE")
			) {
				context.addIssue({
					code: "custom",
					message: "TF requires Choice1 TRUE and Choice2 FALSE.",
				});
				return z.NEVER;
			}
			if (type === "MR") {
				const answerIndexes = [...answer].map((value) => Number(value) - 1);
				if (
					!answer ||
					!/^[1-5]+$/.test(answer) ||
					new Set(answerIndexes).size !== answerIndexes.length ||
					answerIndexes.some((index) => index > lastChoice)
				) {
					context.addIssue({
						code: "custom",
						message: "Answer must list distinct existing choice numbers (1–5).",
					});
					return z.NEVER;
				}
				return {
					type: "multiple-response",
					prompt,
					options: choiceFields.slice(0, lastChoice + 1),
					correctAnswer: answerIndexes
						.map((index) => optionLetters[index])
						.join(", "),
					graded,
				};
			}
			const answerIndex =
				type === "TF"
					? answer === "1"
						? 0
						: answer === "0"
							? 1
							: -1
					: Number(answer) - 1;
			if (
				answerIndex < 0 ||
				answerIndex > lastChoice ||
				(type === "MC" && !/^[1-5]$/.test(answer))
			) {
				context.addIssue({
					code: "custom",
					message:
						type === "TF"
							? "Answer must be 1 for TRUE or 0 for FALSE."
							: "Answer must name an existing choice number (1–5).",
				});
				return z.NEVER;
			}
			return {
				type: "multiple-choice",
				prompt,
				options: choiceFields.slice(0, lastChoice + 1),
				correctAnswer: optionLetters[answerIndex],
				graded,
			};
		},
	)
	.pipe(questionContent);

export const importRequest = z.strictObject({
	courseId,
	operationId,
	rows: z.array(z.unknown()),
});

export function validateQuestionRows(rows: unknown[]) {
	if (rows.length === 0 || rows.length > maxImportRows) {
		return {
			ok: false,
			errors: [`Include 1–${maxImportRows} data rows.`],
		} as const;
	}
	const questions: QuestionContent[] = [];
	const errors: string[] = [];
	for (const [index, row] of rows.entries()) {
		const shape = saaCsvRow.safeParse(row);
		const label = `Record ${index + 2}`;
		if (
			!Array.isArray(row) ||
			row.length !== csvHeaders.length ||
			!shape.success
		) {
			errors.push(`${label}: expected ${csvHeaders.length} text fields.`);
			continue;
		}
		const result = saaCsvRecord.safeParse(shape.data);
		if (result.success) questions.push(result.data);
		else
			for (const issue of result.error.issues) {
				const field =
					typeof issue.path[0] === "number"
						? ` (${csvHeaders[issue.path[0]]})`
						: "";
				errors.push(`${label}${field}: ${issue.message}`);
			}
	}
	return errors.length
		? ({ ok: false, errors } as const)
		: ({ ok: true, questions } as const);
}

export const questionState = z.enum([
	"queued",
	"available",
	"hidden",
	"skipped",
]);
export type QuestionState = z.infer<typeof questionState>;
const reveals = z.strictObject({
	statistics: z.boolean(),
	correctAnswer: z.boolean(),
});
export const noReveals = { statistics: false, correctAnswer: false };
export const planItem = z.object({
	id: questionId,
	question: questionContent,
	state: questionState,
	reveals: reveals.optional(),
});
export const questionPlan = z.object({
	revision: z.number().int().nonnegative(),
	items: z.array(planItem).default([]),
});
export type QuestionPlan = z.infer<typeof questionPlan>;
export const emptyPlan: QuestionPlan = { revision: 0, items: [] };
export const importReceipt = z.object({ ids: z.array(questionId).min(1) });
export const questionRevisionMap = z.record(
	z.string(),
	z.number().int().nonnegative(),
);
export const questionModifiedAtMap = z.record(
	z.string(),
	z.number().int().nonnegative(),
);
export const createQuestionRequest = z.strictObject({
	courseId,
	operationId,
	question: questionContent,
});
export const createQuestionReceipt = z.strictObject({ id: questionId });
export const updateQuestionRequest = z.strictObject({
	courseId,
	id: questionId,
	expectedRevision: z.number().int().nonnegative(),
	operationId,
	question: questionContent,
});
export const updateQuestionReceipt = z.strictObject({
	id: questionId,
	revision: z.number().int().positive(),
});
export const planReceipt = z.object({ revision: z.number().int().positive() });
export const planOperation = z.discriminatedUnion("kind", [
	z.strictObject({ kind: z.literal("add"), id: questionId }),
	z.strictObject({
		kind: z.literal("move"),
		id: questionId,
		by: z.union([z.literal(-1), z.literal(1)]),
	}),
	z.strictObject({ kind: z.literal("shuffle") }),
	z.strictObject({ kind: z.literal("publish-all") }),
	z.strictObject({ kind: z.literal("hide-all") }),
	z.strictObject({ kind: z.literal("publish"), id: questionId }),
	z.strictObject({ kind: z.literal("hide"), id: questionId }),
	z.strictObject({ kind: z.literal("skip"), id: questionId }),
	z.strictObject({ kind: z.literal("restore"), id: questionId }),
	z.strictObject({
		kind: z.literal("reveal"),
		id: questionId,
		target: z.enum(["statistics", "correctAnswer"]),
		visible: z.boolean(),
	}),
]);
export type PlanOperation = z.infer<typeof planOperation>;
export const planRequest = z.strictObject({
	id: codeInput,
	operationId,
	expectedRevision: z.number().int().nonnegative(),
	operation: planOperation,
});

export const liveQuestions = z.strictObject({
	title: z.string(),
	courseNumber,
	semester,
	broadcast: broadcastDocument.optional(),
	questions: z.array(publicQuestion).default([]),
	studentQuestions: z.array(publicStudentQuestion).default([]),
	reveals: z
		.record(
			z.string(),
			z.strictObject({
				statistics: z.literal(true).optional(),
				correctAnswer: z.string().optional(),
			}),
		)
		.optional(),
});
export type LiveLecture = z.infer<typeof liveQuestions>;

export function availableQuestions(plan: QuestionPlan): PublicQuestion[] {
	return plan.items.flatMap(({ state, id, question }) =>
		state === "available" ? [studentQuestion(id, question)] : [],
	);
}

export function questionReveals(
	plan: QuestionPlan,
): NonNullable<LiveLecture["reveals"]> {
	return Object.fromEntries(
		plan.items.flatMap(({ id, question, state, reveals }) => {
			if (state !== "available" || !reveals) return [];
			const shared = {
				...(reveals.statistics ? { statistics: true as const } : {}),
				...(reveals.correctAnswer && question.correctAnswer
					? { correctAnswer: question.correctAnswer }
					: {}),
			};
			return Object.keys(shared).length ? [[id, shared]] : [];
		}),
	);
}
