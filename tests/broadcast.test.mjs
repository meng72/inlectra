import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
	changeBroadcast,
	changeCodeSubmission,
} from "../functions/lib/broadcast-transitions.js";
import { broadcastBody } from "../functions/lib/broadcast.js";

test("broadcasts preserve lines and bound the selected line numbers", () => {
	const body = {
		kind: "code",
		content: "const a = 1;\r\nconst b = 2;\n",
		highlightedLines: [3, 1, 2, 1],
		language: "javascript",
	};
	assert.deepEqual(broadcastBody.parse(body), {
		...body,
		highlightedLines: [1, 2, 3],
	});
	for (const invalid of [
		{ highlightedLines: [4] },
		{ highlightedLines: [0] },
		{ highlightedLines: [1.5] },
		{ language: "unlisted" },
		{ content: "" },
		{ content: "x".repeat(50_001) },
	]) {
		assert.equal(
			broadcastBody.safeParse({ ...body, ...invalid }).success,
			false,
		);
	}
	assert.equal(
		broadcastBody.safeParse({
			kind: "text",
			content: "Note",
			language: "python",
		}).success,
		false,
	);
});

test("broadcast publish, update, and clear each advance once and archive stays final", () => {
	const document = {
		kind: "text",
		content: "Lecture notes",
		highlightedLines: [1],
	};
	const publish = {
		expectedRevision: 0,
		operationId: randomUUID(),
		command: { kind: "publish", document },
	};
	const change = (
		request,
		control,
		state = "open",
		fingerprint = JSON.stringify(request),
	) => changeBroadcast({ request, control, state, fingerprint });
	const published = change(publish);
	assert.deepEqual(published.control.document, { ...document, revision: 1 });
	const updated = change(
		{
			...publish,
			expectedRevision: 1,
			operationId: randomUUID(),
			command: {
				kind: "publish",
				document: { ...document, content: "Updated" },
			},
		},
		published.control,
	);
	assert.equal(updated.control.document.content, "Updated");
	assert.equal(updated.receipt.revision, 2);
	const clear = {
		expectedRevision: 2,
		operationId: randomUUID(),
		command: { kind: "clear" },
	};
	const cleared = change(clear, updated.control);
	assert.deepEqual(cleared.receipt, { revision: 3 });
	assert.equal(cleared.control.document, undefined);
	assert.deepEqual(change(publish, cleared.control, "archived"), {
		kind: "replay",
		receipt: { revision: 1 },
	});
	assert.equal(
		change(publish, cleared.control, "open", "different").kind,
		"already-exists",
	);
	assert.equal(
		change({ ...clear, operationId: randomUUID() }, cleared.control).kind,
		"aborted",
	);
	assert.equal(
		change(
			{ ...clear, expectedRevision: 3, operationId: randomUUID() },
			cleared.control,
			"archived",
		).kind,
		"failed-precondition",
	);
});

test("code submission requires an open lecture, membership, and the current code revision", () => {
	const request = {
		expectedRevision: 0,
		operationId: randomUUID(),
		broadcastRevision: 1,
		content: "draft",
	};
	const control = {
		revision: 1,
		document: { kind: "code", revision: 1 },
		operations: {},
	};
	const submit = (options = {}) =>
		changeCodeSubmission({
			request,
			control,
			member: true,
			state: "open",
			fingerprint: "draft",
			now: 10,
			email: "student@example.test",
			...options,
		});
	const first = submit();
	assert.deepEqual(first.receipt, {
		revision: 1,
		broadcastRevision: 1,
		firstSubmittedAt: 10,
		updatedAt: 10,
	});
	assert.equal(first.submission.accepted.content, "draft");
	assert.equal(submit({ member: false }).kind, "permission-denied");
	assert.equal(
		submit({ control: { ...control, document: { kind: "text", revision: 1 } } })
			.kind,
		"failed-precondition",
	);
	assert.equal(
		submit({
			control: { ...control, document: { ...control.document, revision: 2 } },
		}).kind,
		"failed-precondition",
	);
	assert.equal(submit({ state: "archived" }).kind, "failed-precondition");
	assert.deepEqual(submit({ previous: first.submission, state: "archived" }), {
		kind: "replay",
		receipt: first.receipt,
	});
	assert.equal(
		submit({ previous: first.submission, fingerprint: "changed" }).kind,
		"already-exists",
	);
	assert.equal(
		submit({
			previous: first.submission,
			request: { ...request, operationId: randomUUID() },
		}).kind,
		"aborted",
	);
});
