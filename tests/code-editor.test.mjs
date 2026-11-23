import assert from "node:assert/strict";
import test from "node:test";
import { insertCodeTab } from "../src/codeEditor.ts";

test("Tab inserts one tab character at the code editor selection", () => {
	assert.deepEqual(insertCodeTab("const value = 1;", 6, 11, 50_000), {
		content: "const \t = 1;",
		cursor: 7,
	});
	assert.deepEqual(insertCodeTab("line one\nline two", 9, 9, 50_000), {
		content: "line one\n\tline two",
		cursor: 10,
	});
});

test("Tab does not exceed the code content limit", () => {
	assert.equal(insertCodeTab("full", 4, 4, 4), undefined);
	assert.deepEqual(insertCodeTab("full", 0, 4, 4), {
		content: "\t",
		cursor: 1,
	});
});
