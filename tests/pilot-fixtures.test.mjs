import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
	csvHeaders,
	validateQuestionRows,
} from "../functions/lib/questions.js";
import {
	rosterHeaders,
	validateRosterRows,
} from "../functions/lib/reporting.js";
import { readCsv } from "../src/readCsv.ts";

async function fixture(name) {
	return readFile(new URL(`../examples/pilot/${name}`, import.meta.url), "utf8");
}

test("the synthetic question fixture matches the supported import contract", async () => {
	const [header, ...rows] = readCsv(await fixture("questions.csv"));
	assert.deepEqual(header, [...csvHeaders]);
	const result = validateQuestionRows(rows);
	assert.equal(result.ok, true, result.ok ? undefined : result.errors.join("\n"));
	assert.equal(result.questions.length, 5);
	assert.equal(result.questions.some((question) => question.graded), true);
	assert.equal(result.questions.some((question) => !question.graded), true);
});

test("the synthetic roster fixture matches the supported import contract", async () => {
	const rows = readCsv(await fixture("roster.csv"));
	assert.deepEqual(rows[0], [...rosterHeaders]);
	const result = validateRosterRows(rows);
	assert.equal(result.ok, true, result.ok ? undefined : result.errors.join("\n"));
	assert.equal(result.entries.length, 8);
	for (const entry of result.entries) {
		assert.match(entry.email, /^student\d{2}@example\.test$/);
		assert.match(entry.canvasIdentifier, /^canvas-synthetic-\d{3}$/);
	}
});
