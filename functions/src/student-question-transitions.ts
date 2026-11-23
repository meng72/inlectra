import {
	publicStudentQuestion,
	studentQuestionId,
	studentQuestionRecord,
	studentQuestionText,
	type PublicStudentQuestion,
	type StudentQuestionRecord,
} from "./student-questions.js";

type Principal = {
	uid: string;
	email: string;
	displayName?: string;
};

type Accepted = {
	kind: "accepted";
	record: StudentQuestionRecord;
	publicQuestion?: PublicStudentQuestion;
};
type Rejected = {
	kind: "invalid-argument" | "aborted" | "failed-precondition";
};
type Change = Accepted | Rejected;

function publicProjection(
	record: StudentQuestionRecord,
): PublicStudentQuestion | undefined {
	if (record.visibility !== "published" || record.publishedAt === undefined)
		return undefined;
	return publicStudentQuestion.parse({
		id: record.id,
		text: record.text,
		publishedAt: record.publishedAt,
		answered: record.reviewState === "answered",
	});
}

export function createStudentQuestion({
	questionId,
	principal,
	text,
	now,
}: {
	questionId: string;
	principal: Principal;
	text: string;
	now: number;
}): Change {
	const parsedId = studentQuestionId.safeParse(questionId);
	const parsedText = studentQuestionText.safeParse(text);
	if (!parsedId.success || !parsedText.success)
		return { kind: "invalid-argument" };
	const record = studentQuestionRecord.safeParse({
		id: parsedId.data,
		authorUid: principal.uid,
		authorEmail: principal.email,
		...(principal.displayName
			? { authorDisplayName: principal.displayName }
			: {}),
		text: parsedText.data,
		reviewState: "open",
		visibility: "private",
		revision: 1,
		createdAt: now,
		updatedAt: now,
	});
	return record.success
		? { kind: "accepted", record: record.data }
		: { kind: "invalid-argument" };
}

export function reviseStudentQuestion({
	record,
	expectedRevision,
	text,
	now,
}: {
	record: StudentQuestionRecord;
	expectedRevision: number;
	text: string;
	now: number;
}): Change {
	if (record.revision !== expectedRevision) return { kind: "aborted" };
	if (record.reviewState !== "open" || record.visibility !== "private")
		return { kind: "failed-precondition" };
	const parsed = studentQuestionText.safeParse(text);
	if (!parsed.success) return { kind: "invalid-argument" };
	const updated = studentQuestionRecord.parse({
		...record,
		text: parsed.data,
		revision: record.revision + 1,
		updatedAt: now,
	});
	return { kind: "accepted", record: updated };
}

export function withdrawStudentQuestion({
	record,
	expectedRevision,
	now,
}: {
	record: StudentQuestionRecord;
	expectedRevision: number;
	now: number;
}): Change {
	if (record.revision !== expectedRevision) return { kind: "aborted" };
	if (record.reviewState !== "open" || record.visibility !== "private")
		return { kind: "failed-precondition" };
	return {
		kind: "accepted",
		record: studentQuestionRecord.parse({
			...record,
			reviewState: "withdrawn",
			revision: record.revision + 1,
			updatedAt: now,
		}),
	};
}

export function reviewStudentQuestion({
	record,
	expectedRevision,
	action,
	now,
}: {
	record: StudentQuestionRecord;
	expectedRevision: number;
	action: "publish" | "answer" | "dismiss";
	now: number;
}): Change {
	if (record.revision !== expectedRevision) return { kind: "aborted" };
	if (record.reviewState !== "open")
		return { kind: "failed-precondition" };
	if (action === "publish" && record.visibility === "published")
		return { kind: "failed-precondition" };
	const updated = studentQuestionRecord.parse({
		...record,
		...(action === "publish"
			? { visibility: "published", publishedAt: now }
			: {}),
		...(action === "answer" ? { reviewState: "answered" } : {}),
		...(action === "dismiss"
			? { reviewState: "dismissed", visibility: "private" }
			: {}),
		revision: record.revision + 1,
		updatedAt: now,
	});
	const publicQuestion = publicProjection(updated);
	return {
		kind: "accepted",
		record: updated,
		...(publicQuestion ? { publicQuestion } : {}),
	};
}
