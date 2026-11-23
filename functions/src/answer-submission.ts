import type { z } from "zod";
import type {
	QuestionActivity,
	QuestionStats,
	SubmissionRequest,
	submissionReceipt,
} from "./answers.js";
import { optionLetters, type planItem } from "./questions.js";

type SubmissionDecision =
	| {
			kind: "accepted";
			activity: QuestionActivity;
			receipt: z.infer<typeof submissionReceipt>;
	  }
	| { kind: "replay"; receipt: z.infer<typeof submissionReceipt> }
	| {
			kind:
				| "permission-denied"
				| "failed-precondition"
				| "invalid-argument"
				| "aborted"
				| "already-exists";
	  };

function summarize(
	question: z.infer<typeof planItem>["question"],
	responses: QuestionActivity["responses"],
): QuestionStats {
	const records = Object.values(responses);
	if (question.type === "short-answer" || question.type === "numeric") {
		return { type: question.type, total: records.length };
	}
	const counts = Object.fromEntries(
		question.options.map((_, index) => [optionLetters[index], 0]),
	);
	for (const { accepted } of records) {
		if (accepted.answer.type === "multiple-choice") {
			counts[accepted.answer.option]++;
		} else if (accepted.answer.type === "multiple-response") {
			for (const option of accepted.answer.options) counts[option]++;
		}
	}
	return { type: question.type, total: records.length, counts };
}

export function decideSubmission({
	activity,
	item,
	member,
	principal,
	request,
	fingerprint,
	now,
}: {
	activity?: QuestionActivity;
	item?: z.infer<typeof planItem>;
	member: boolean;
	principal: { uid: string; email: string };
	request: SubmissionRequest;
	fingerprint: string;
	now: number;
}): SubmissionDecision {
	const { uid, email } = principal;
	if (!member) return { kind: "permission-denied" };
	const records = activity?.responses ?? {};
	const previous = Object.hasOwn(records, uid) ? records[uid] : undefined;
	const replay = previous?.operations[request.operationId];
	if (replay) {
		return replay.fingerprint === fingerprint
			? { kind: "replay", receipt: replay.receipt }
			: { kind: "already-exists" };
	}
	if (item?.state !== "available") return { kind: "failed-precondition" };
	if ((previous?.accepted.revision ?? 0) !== request.expectedRevision) {
		return { kind: "aborted" };
	}
	const { answer } = request;
	const { question } = item;
	if (
		answer.type !== question.type ||
		(answer.type === "multiple-choice" &&
			question.type === "multiple-choice" &&
			optionLetters.indexOf(answer.option) >= question.options.length) ||
		(answer.type === "multiple-response" &&
			question.type === "multiple-response" &&
			answer.options.some(
				(option) => optionLetters.indexOf(option) >= question.options.length,
			))
	)
		return { kind: "invalid-argument" };

	const receipt = {
		revision: request.expectedRevision + 1,
		participationPoint:
			previous?.accepted.participationPoint ?? (question.graded ? 1 : 0),
		firstSubmittedAt: previous?.accepted.firstSubmittedAt ?? now,
		updatedAt: now,
	} satisfies z.infer<typeof submissionReceipt>;
	const responses = {
		...records,
		[uid]: {
			accepted: { ...receipt, answer },
			email,
			operations: {
				...previous?.operations,
				[request.operationId]: { fingerprint, receipt },
			},
		},
	};
	return {
		kind: "accepted",
		receipt,
		activity: { responses, publicStats: summarize(question, responses) },
	};
}
