import { z } from "zod";
import { codeInput, operationId } from "./contract.js";

export const broadcastLimit = 50_000;
export const broadcastLanguage = z.enum([
	"plain",
	"javascript",
	"typescript",
	"python",
	"java",
	"c",
	"cpp",
	"json",
	"markup",
	"css",
	"bash",
]);
export const languageNames: Record<
	z.infer<typeof broadcastLanguage>,
	string
> = {
	plain: "Plain text",
	javascript: "JavaScript",
	typescript: "TypeScript",
	python: "Python",
	java: "Java",
	c: "C",
	cpp: "C++",
	json: "JSON",
	markup: "HTML",
	css: "CSS",
	bash: "Bash",
};
export const splitBroadcastLines = (content: string) =>
	content.split(/\r\n|\r|\n/);
export const broadcastContent = z.string().min(1).max(broadcastLimit);
const lines = z
	.array(z.number().int().positive())
	.max(broadcastLimit + 1)
	.default([]);
const body = { content: broadcastContent, highlightedLines: lines };
const text = z.strictObject({ kind: z.literal("text"), ...body });
const code = z.strictObject({
	kind: z.literal("code"),
	...body,
	language: broadcastLanguage,
});
const revision = z.number().int().nonnegative();
const publishedRevision = z.number().int().positive();
const normalizeLines = <
	T extends { content: string; highlightedLines: number[] },
>(
	document: T,
	context: z.RefinementCtx,
) => {
	const lineCount = splitBroadcastLines(document.content).length;
	if (document.highlightedLines.some((line) => line > lineCount)) {
		context.addIssue({
			code: "custom",
			message: "A highlighted line is outside the broadcast.",
		});
		return z.NEVER;
	}
	return {
		...document,
		highlightedLines: [...new Set(document.highlightedLines)].sort(
			(a, b) => a - b,
		),
	};
};
export const broadcastBody = z
	.discriminatedUnion("kind", [text, code])
	.transform(normalizeLines);
export type BroadcastBody = z.infer<typeof broadcastBody>;
export const broadcastDocument = z
	.discriminatedUnion("kind", [
		text.extend({ revision: publishedRevision }),
		code.extend({ revision: publishedRevision }),
	])
	.transform(normalizeLines);
export type BroadcastDocument = z.infer<typeof broadcastDocument>;
export const broadcastRequest = z.strictObject({
	id: codeInput,
	operationId,
	expectedRevision: revision,
	command: z.discriminatedUnion("kind", [
		z.strictObject({ kind: z.literal("publish"), document: broadcastBody }),
		z.strictObject({ kind: z.literal("clear") }),
	]),
});
export type BroadcastRequest = z.infer<typeof broadcastRequest>;
export const broadcastReceipt = z.strictObject({ revision: publishedRevision });
export const broadcastControl = z.strictObject({
	revision,
	document: broadcastDocument.optional(),
	operations: z.record(
		z.string(),
		z.strictObject({
			fingerprint: z.string(),
			receipt: broadcastReceipt,
		}),
	),
});
export type BroadcastControl = z.infer<typeof broadcastControl>;

export const codeRequest = z.strictObject({
	id: codeInput,
	operationId,
	broadcastRevision: publishedRevision,
	expectedRevision: revision,
	content: broadcastContent,
});
export type CodeRequest = z.infer<typeof codeRequest>;
export const codeReceipt = z.strictObject({
	revision: publishedRevision,
	broadcastRevision: publishedRevision,
	firstSubmittedAt: z.number(),
	updatedAt: z.number(),
});
export const acceptedCode = codeReceipt.extend({ content: broadcastContent });
export const codeSubmission = z.strictObject({
	accepted: acceptedCode,
	email: z.string().min(1),
	operations: z.record(
		z.string(),
		z.strictObject({ fingerprint: z.string(), receipt: codeReceipt }),
	),
});
export type CodeSubmission = z.infer<typeof codeSubmission>;
