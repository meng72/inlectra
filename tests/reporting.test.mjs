import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
	buildReport,
	changeRoster,
	validateRosterRows,
} from "../functions/lib/reporting.js";

const question = (id, graded = true, state = "available") => ({
	id,
	state,
	question: {
		type: "short-answer",
		prompt: id,
		graded,
		correctAnswer: "",
	},
});

test("roster rows require exact headers and unambiguous email and Canvas mappings", () => {
	const valid = [
		["email", "display_name", "canvas_identifier"],
		[" Alice@Example.test ", " Alice ", " 1001 "],
		["bob@example.test", "", "1002"],
	];
	assert.deepEqual(validateRosterRows(valid), {
		ok: true,
		entries: [
			{
				email: "alice@example.test",
				displayName: "Alice",
				canvasIdentifier: "1001",
			},
			{
				email: "bob@example.test",
				canvasIdentifier: "1002",
			},
		],
	});
	for (const rows of [
		[["email", "name", "canvas_identifier"], valid[1]],
		[valid[0]],
		[valid[0], valid[1], ["ALICE@example.test", "Other", "1003"]],
		[valid[0], valid[1], ["other@example.test", "Other", "1001"]],
		[valid[0], ["not an email", "Student", "1004"]],
	]) {
		assert.equal(validateRosterRows(rows).ok, false);
	}
});

test("roster replacement is revisioned and retries return the original receipt", () => {
	const operationId = randomUUID();
	const request = {
		operationId,
		expectedRevision: 0,
		entries: [
			{
				email: "student@example.test",
				displayName: "Student",
				canvasIdentifier: "7",
			},
		],
	};
	const first = changeRoster({ request, fingerprint: "same" });
	assert.deepEqual(first.receipt, { revision: 1, count: 1 });
	assert.deepEqual(
		changeRoster({
			control: first.control,
			request,
			fingerprint: "same",
		}),
		{ kind: "replay", receipt: first.receipt },
	);
	assert.equal(
		changeRoster({
			control: first.control,
			request,
			fingerprint: "different",
		}).kind,
		"already-exists",
	);
	assert.equal(
		changeRoster({
			control: first.control,
			request: { ...request, operationId: randomUUID() },
			fingerprint: "next",
		}).kind,
		"aborted",
	);
});

test("reports include graded credits, omit skipped and ungraded questions, and protect CSV cells", () => {
	const members = {
		alice: {
			email: "alice@example.test",
			displayName: "=HYPERLINK(\"bad\")",
			joinedAt: 1,
		},
		bob: { email: "bob@example.test", displayName: "Bob", joinedAt: 2 },
	};
	const plan = {
		revision: 1,
		items: [
			question("00000000-0000-4000-8000-000000000001"),
			question("00000000-0000-4000-8000-000000000002", false),
			question("00000000-0000-4000-8000-000000000003", true, "skipped"),
		],
	};
	const response = (email, point) => ({
		accepted: {
			answer: { type: "short-answer", text: "answer" },
			firstSubmittedAt: 1,
			participationPoint: point,
			revision: 1,
			updatedAt: 1,
		},
		email,
		operations: {},
	});
	const activity = {
		[plan.items[0].id]: {
			responses: { alice: response(members.alice.email, 1) },
			publicStats: { type: "short-answer", total: 1 },
		},
	};
	const participation = buildReport({
		kind: "participation",
		members,
		plan,
		activity,
	});
	assert.equal(participation.rowCount, 2);
	assert.deepEqual(participation.unmatched, []);
	assert.match(
		participation.csv,
		/^"email","display_name","question_1_credit","total"\r?\n/,
	);
	assert.match(participation.csv, /"'=HYPERLINK\(""bad""\)"/);
	assert.match(participation.csv, /"alice@example\.test".*,"1","1"/);
	assert.match(participation.csv, /"bob@example\.test".*,"0","0"/);

	const canvas = buildReport({
		kind: "canvas",
		members,
		plan,
		activity,
		roster: [
			{
				email: "alice@example.test",
				displayName: "Alice",
				canvasIdentifier: "+1001",
			},
		],
	});
	assert.equal(canvas.rowCount, 1);
	assert.match(canvas.csv, /^"canvas_identifier","participation_score"/);
	assert.match(canvas.csv, /"'\+1001","1"/);
	assert.deepEqual(canvas.unmatched, [
		{
			email: "bob@example.test",
			displayName: "Bob",
			reason: "no-roster-match",
		},
	]);
});

test("Canvas export withholds duplicate participant emails and handles 80 students", () => {
	const members = Object.fromEntries(
		Array.from({ length: 80 }, (_, index) => [
			`uid-${index}`,
			{
				email: `student-${index}@example.test`,
				displayName: `Student ${index}`,
				joinedAt: index,
			},
		]),
	);
	members.duplicate = {
		email: members["uid-0"].email.toUpperCase(),
		displayName: "Second account",
		joinedAt: 81,
	};
	const plan = {
		revision: 1,
		items: [question("00000000-0000-4000-8000-000000000001")],
	};
	const roster = Object.values(members).map((member, index) => ({
		email: member.email.toLowerCase(),
		canvasIdentifier: String(index + 1),
	}));
	const report = buildReport({
		kind: "canvas",
		members,
		plan,
		activity: {},
		roster: roster.slice(0, 80),
	});
	assert.equal(report.rowCount, 79);
	assert.equal(report.unmatched.length, 2);
	assert.ok(
		report.unmatched.every(
			(entry) => entry.reason === "duplicate-participant-email",
		),
	);
});
