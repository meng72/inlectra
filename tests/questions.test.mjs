import assert from "node:assert/strict";
import test from "node:test";
import {
	changeQuestionPlan,
	nextQuestionState,
} from "../functions/lib/question-plan.js";
import {
	availableQuestions,
	emptyPlan,
	validateQuestionRows,
} from "../functions/lib/questions.js";
import { readCsv } from "../src/readCsv.ts";

const choice = [
	"MC",
	"",
	"1",
	" Pick one ",
	"2",
	" A choice ",
	"B choice",
	"",
	"",
	"",
];
const short = ["ESSAY", "", "0", "Explain.", "____", "", "", "", "", ""];
const id = "3a2558c1-551c-4b07-98c6-7a712951216e";
const secondId = "f193955b-f76c-4e0c-93cc-b93a448b2443";

test("the CSV reader preserves quoted commas, line breaks, and escaped quotes and rejects malformed quotes", () => {
	const text =
		'\uFEFFtype,prompt\r\nshort-answer,"Line 1, ""quoted""\r\nLine 2"\r\n';
	assert.deepEqual(readCsv(text), [
		["type", "prompt"],
		["short-answer", 'Line 1, "quoted"\r\nLine 2'],
	]);
	for (const invalid of ['bad"quote', '"open quote', '"closed"and more']) {
		assert.throws(
			() => readCsv(`type,prompt\nshort-answer,${invalid}`),
			/Record 2/,
		);
	}
});

test("question records normalize and validate settings without accepting a partial batch", () => {
	const validated = validateQuestionRows([choice, short]);
	assert.deepEqual(validated, {
		ok: true,
		questions: [
			{
				type: "multiple-choice",
				prompt: "Pick one",
				options: ["A choice", "B choice"],
				correctAnswer: "B",
				graded: true,
			},
			{
				type: "short-answer",
				prompt: "Explain.",
				correctAnswer: "",
				graded: false,
			},
		],
	});
	for (const bad of [
		["MC", "", "1", "Missing choice.", "3", "One", "Two", "", "", ""],
		["MC", "", "1", "Gap.", "3", "One", "", "Three", "", ""],
		["ESSAY", "", "1", "Essay.", "____", "Not blank", "", "", "", ""],
		["UNKNOWN", "", "1", "Unknown.", "1", "One", "Two", "", "", ""],
		["TF", "", "1", "Bad true false.", "1", "Yes", "No", "", "", ""],
		["NUM", "", "1", "Not numeric.", "ten", "", "", "", "", ""],
		short.slice(0, 9),
		["ESSAY", "", "1", "x".repeat(2001), "____", "", "", "", "", ""],
	]) {
		const result = validateQuestionRows([choice, bad]);
		assert.equal(result.ok, false);
		assert.match(result.errors[0], /Record 3/);
		assert.equal("questions" in result, false);
	}
	assert.equal(validateQuestionRows(Array(101).fill(short)).ok, false);
});

test("SAA records map MC, MR, TF, NUM, and ESSAY questions", () => {
	const result = validateQuestionRows([
		[
			"MC",
			"Synthetic title",
			"2",
			"Choose the final option.",
			"5",
			"One",
			"Two",
			"Three",
			"Four",
			"Five",
		],
		["MR", "", "3", "Choose several.", "245", "One", "Two", "Three", "Four", "Five"],
		["TF", "", "1", "The statement is false.", "0", "TRUE", "FALSE", "", "", ""],
		["NUM", "", "3", "Enter a number.", "10", "", "", "", "", ""],
		["ESSAY", "", "8", "Explain the result.", "____", "", "", "", "", ""],
	]);
	assert.deepEqual(result, {
		ok: true,
		questions: [
			{
				type: "multiple-choice",
				prompt: "Choose the final option.",
				options: ["One", "Two", "Three", "Four", "Five"],
				correctAnswer: "E",
				graded: true,
			},
			{
				type: "multiple-response",
				prompt: "Choose several.",
				options: ["One", "Two", "Three", "Four", "Five"],
				correctAnswer: "B, D, E",
				graded: true,
			},
			{
				type: "multiple-choice",
				prompt: "The statement is false.",
				options: ["TRUE", "FALSE"],
				correctAnswer: "B",
				graded: true,
			},
			{
				type: "numeric",
				prompt: "Enter a number.",
				correctAnswer: "10",
				graded: true,
			},
			{
				type: "short-answer",
				prompt: "Explain the result.",
				correctAnswer: "",
				graded: true,
			},
		],
	});
	for (const bad of [
		["MC", "", "1", "Gap.", "3", "One", "", "Three", "", ""],
		["MC", "", "1", "Missing answer.", "3", "One", "Two", "", "", ""],
		["MC", "", "-1", "Bad points.", "1", "One", "Two", "", "", ""],
	]) {
		assert.equal(validateQuestionRows([bad]).ok, false);
	}
	assert.equal(
		validateQuestionRows([
			["multiple-choice", "Legacy", "One", "Two", "", "", "A", "true"],
		]).ok,
		false,
	);
});

test("the live projection follows plan order and explicitly omits answer keys", () => {
	const [choiceQuestion, shortQuestion] = validateQuestionRows([
		choice,
		short,
	]).questions;
	const thirdId = "b28fc54f-eff2-431a-96a9-217c844b283d";
	assert.deepEqual(
		availableQuestions({
			revision: 1,
			items: [
				{ id: thirdId, question: shortQuestion, state: "hidden" },
				{ id: secondId, question: shortQuestion, state: "available" },
				{ id, question: choiceQuestion, state: "available" },
			],
		}),
		[
			{ id: secondId, type: "short-answer", prompt: "Explain.", graded: false },
			{
				id,
				type: "multiple-choice",
				prompt: "Pick one",
				options: ["A choice", "B choice"],
				graded: true,
			},
		],
	);
});

test("plan commands respect revision, lifecycle, and question state", () => {
	const [question] = validateQuestionRows([choice]).questions;
	const input = {
		state: "open",
		plan: emptyPlan,
		expectedRevision: 0,
		operation: { kind: "add", id },
		question,
		randomIndex: () => 0,
	};
	assert.deepEqual(changeQuestionPlan({ ...input, state: "archived" }), {
		kind: "archived",
	});
	const added = changeQuestionPlan(input);
	assert.deepEqual(added, {
		kind: "applied",
		plan: { revision: 1, items: [{ id, question, state: "queued" }] },
	});
	assert.deepEqual(changeQuestionPlan({ ...input, plan: added.plan }), {
		kind: "stale",
	});
	assert.deepEqual(
		changeQuestionPlan({
			...input,
			plan: added.plan,
			expectedRevision: 1,
			operation: { kind: "hide", id },
		}),
		{ kind: "invalid" },
	);
	assert.equal(nextQuestionState("queued", "publish"), "available");
	assert.equal(nextQuestionState("available", "hide"), "hidden");
	assert.equal(nextQuestionState("hidden", "skip"), "skipped");
	assert.equal(nextQuestionState("skipped", "restore"), "queued");
	assert.equal(nextQuestionState("queued", "restore"), undefined);
	assert.equal(nextQuestionState("available", "publish"), undefined);
});

test("bulk publish and hide update every eligible queue item once", () => {
	const [question] = validateQuestionRows([choice]).questions;
	const thirdId = "b28fc54f-eff2-431a-96a9-217c844b283d";
	const plan = {
		revision: 4,
		items: [
			{ id, question, state: "queued" },
			{
				id: secondId,
				question,
				state: "hidden",
				reveals: { statistics: true, correctAnswer: true },
			},
			{ id: thirdId, question, state: "skipped" },
		],
	};
	const input = {
		state: "open",
		plan,
		expectedRevision: 4,
		operation: { kind: "publish-all" },
		randomIndex: () => 0,
	};
	const published = changeQuestionPlan(input);
	assert.equal(published.kind, "applied");
	assert.equal(published.plan.revision, 5);
	assert.deepEqual(
		published.plan.items.map(({ state, reveals }) => ({ state, reveals })),
		Array(3).fill({ state: "available", reveals: undefined }),
	);

	const hidden = changeQuestionPlan({
		...input,
		plan: published.plan,
		expectedRevision: 5,
		operation: { kind: "hide-all" },
	});
	assert.equal(hidden.kind, "applied");
	assert.equal(hidden.plan.revision, 6);
	assert.deepEqual(
		hidden.plan.items.map(({ state, reveals }) => ({ state, reveals })),
		Array(3).fill({ state: "hidden", reveals: undefined }),
	);
	assert.deepEqual(
		changeQuestionPlan({
			...input,
			plan: hidden.plan,
			expectedRevision: 6,
			operation: { kind: "hide-all" },
		}),
		{ kind: "invalid" },
	);
});
