import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { readdir, readFile } from "node:fs/promises";

const budget = 200 * 1024;
const directory = new URL("../dist/assets/", import.meta.url);
const files = (await readdir(directory)).filter((name) =>
	/^index-[\w-]+\.js$/.test(name),
);
assert.equal(files.length, 1, "Expected one main JavaScript bundle.");
const source = await readFile(new URL(files[0], directory));
const compressedBytes = gzipSync(source).byteLength;
const kibibytes = (compressedBytes / 1024).toFixed(1);
console.log(`Main bundle: ${kibibytes} KiB gzip. Budget: 200.0 KiB gzip.`);
assert.ok(
	compressedBytes <= budget,
	`Main bundle is ${kibibytes} KiB gzip and exceeds the 200.0 KiB budget.`,
);
