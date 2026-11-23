import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { decideSubmission } from "../functions/lib/answer-submission.js";
import { submissionRequest } from "../functions/lib/answers.js";
import { changeQuestionPlan } from "../functions/lib/question-plan.js";
import { questionReveals } from "../functions/lib/questions.js";

const edit = {
	member: true,
	principal: { uid: "student", email: "student@example.test" },
	now: 10,
};
const questionId = randomUUID();
const item = {
	id: questionId,
	state: "available",
	question: {
		type: "multiple-choice",
		prompt: "Pick a number.",
		options: ["One", "Two"],
		correctAnswer: "B",
		graded: true,
	},
};
const answer = (option) => ({ type: "multiple-choice", option });
const command = (response, expectedRevision = 0) => ({
	id: "ABCDEF123456",
	questionId,
	operationId: randomUUID(),
	expectedRevision,
	answer: response,
});
const query = (request, activity, overrides = {}) =>
	decideSubmission({
		...edit,
		item,
		request,
		activity,
		fingerprint: JSON.stringify(request),
		...overrides,
	});

test("first and revised graded answers earn one point even when incorrect", () => {
	const original = command(answer("A"));
	const first = query(original);
	assert.deepEqual(first.receipt, {
		revision: 1,
		participationPoint: 1,
		firstSubmittedAt: 10,
		updatedAt: 10,
	});
	assert.deepEqual(first.activity.publicStats, {
		type: "multiple-choice",
		total: 1,
		counts: { A: 1, B: 0 },
	});
	const revision = query(command(answer("B"), 1), first.activity, { now: 20 });
	assert.deepEqual(revision.receipt, {
		revision: 2,
		participationPoint: 1,
		firstSubmittedAt: 10,
		updatedAt: 20,
	});
	assert.deepEqual(revision.activity.publicStats, {
		type: "multiple-choice",
		total: 1,
		counts: { A: 0, B: 1 },
	});
	assert.deepEqual(query(original, revision.activity), {
		kind: "replay",
		receipt: first.receipt,
	});
	assert.equal(
		query({ ...original, answer: answer("B") }, revision.activity).kind,
		"already-exists",
	);
	assert.equal(
		query(command(answer("A"), 1), revision.activity).kind,
		"aborted",
	);
});

test("short answers are trimmed, ungraded answers earn zero, and aggregates omit text", () => {
	const request = submissionRequest.parse(
		command({ type: "short-answer", text: "  private answer  " }),
	);
	const first = query(request, undefined, {
		item: {
			...item,
			question: {
				type: "short-answer",
				prompt: "Explain.",
				correctAnswer: "",
				graded: false,
			},
		},
	});
	assert.equal(first.receipt.participationPoint, 0);
	assert.equal(
		first.activity.responses.student.accepted.answer.text,
		"private answer",
	);
	assert.deepEqual(first.activity.publicStats, {
		type: "short-answer",
		total: 1,
	});
	assert.equal(
		submissionRequest.safeParse(command({ type: "short-answer", text: " " }))
			.success,
		false,
	);
	assert.equal(
		submissionRequest.safeParse(
			command({ type: "short-answer", text: "x".repeat(2001) }),
		).success,
		false,
	);
});

test("submission requires membership, an available question, and a matching answer", () => {
	assert.equal(
		query(command(answer("A")), undefined, { member: false }).kind,
		"permission-denied",
	);
	for (const state of ["queued", "skipped", "hidden"]) {
		assert.equal(
			query(command(answer("A")), undefined, { item: { ...item, state } }).kind,
			"failed-precondition",
		);
	}
	assert.equal(
		query(command(answer("A")), undefined, { item: undefined }).kind,
		"failed-precondition",
	);
	assert.equal(query(command(answer("C"))).kind, "invalid-argument");
	assert.equal(
		query(command({ type: "short-answer", text: "One" })).kind,
		"invalid-argument",
	);
});

test("a fifth multiple-choice option is accepted and counted", () => {
	const fifth = query(command(answer("E")), undefined, {
		item: {
			...item,
			question: {
				...item.question,
				options: ["One", "Two", "Three", "Four", "Five"],
				correctAnswer: "E",
			},
		},
	});
	assert.deepEqual(fifth.activity.publicStats, {
		type: "multiple-choice",
		total: 1,
		counts: { A: 0, B: 0, C: 0, D: 0, E: 1 },
	});
});

test("multiple-response selections are accepted and counted by option", () => {
	const request = submissionRequest.parse(
		command({ type: "multiple-response", options: ["B", "D", "E"] }),
	);
	const multiple = query(request, undefined, {
		item: {
			...item,
			question: {
				type: "multiple-response",
				prompt: "Choose several.",
				options: ["One", "Two", "Three", "Four", "Five"],
				correctAnswer: "B, D, E",
				graded: true,
			},
		},
	});
	assert.deepEqual(multiple.activity.publicStats, {
		type: "multiple-response",
		total: 1,
		counts: { A: 0, B: 1, C: 0, D: 1, E: 1 },
	});
});

test("numeric answers reject nonnumeric text and keep aggregates private", () => {
	const numeric = submissionRequest.parse(
		command({ type: "numeric", value: " 10.5 " }),
	);
	const result = query(numeric, undefined, {
		item: {
			...item,
			question: {
				type: "numeric",
				prompt: "Enter a number.",
				correctAnswer: "10.5",
				graded: true,
			},
		},
	});
	assert.equal(result.activity.responses.student.accepted.answer.value, "10.5");
	assert.deepEqual(result.activity.publicStats, { type: "numeric", total: 1 });
	assert.equal(
		submissionRequest.safeParse(
			command({ type: "numeric", value: "ten" }),
		).success,
		false,
	);
});

test("statistics and answer reveals are independent and reset after hiding and publishing", () => {
	let plan = { revision: 0, items: [item] };
	const change = (operation, state = "open") =>
		changeQuestionPlan({
			state,
			plan,
			operation: { ...operation, id: item.id },
			expectedRevision: plan.revision,
			randomIndex: () => 0,
		});
	const stats = { kind: "reveal", target: "statistics", visible: true };
	const revealAnswer = {
		kind: "reveal",
		target: "correctAnswer",
		visible: true,
	};
	assert.deepEqual(questionReveals(plan), {});
	plan = change(stats).plan;
	assert.deepEqual(questionReveals(plan), { [item.id]: { statistics: true } });
	plan = change(revealAnswer).plan;
	assert.deepEqual(questionReveals(plan), {
		[item.id]: { statistics: true, correctAnswer: "B" },
	});
	plan = change({ ...stats, visible: false }).plan;
	assert.deepEqual(questionReveals(plan), {
		[item.id]: { correctAnswer: "B" },
	});
	plan = change({ kind: "hide" }).plan;
	assert.deepEqual(questionReveals(plan), {});
	assert.equal(change(stats).kind, "invalid");
	plan = change({ kind: "publish" }).plan;
	assert.deepEqual(questionReveals(plan), {});
	assert.equal(change(revealAnswer, "archived").kind, "archived");
});
