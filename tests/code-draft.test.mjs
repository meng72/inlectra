import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { createDraftStore } from "../src/codeDraftStore.ts";

test("drafts survive reopening, are scoped by account and lecture, and can be replaced or discarded", async () => {
	const indexedDb = new IDBFactory();
	const original = { uid: "student", id: "ABCDEF123456" };
	const otherAccount = { ...original, uid: "peer" };
	const otherLecture = { ...original, id: "ABCDEF654321" };
	const draft = {
		content: "const local = 1;",
		broadcastRevision: 2,
		updatedAt: 10,
	};
	const store = createDraftStore(indexedDb);
	await store.write(original, draft);
	const reopened = createDraftStore(indexedDb);
	assert.deepEqual(await reopened.read(original), draft);
	assert.equal(await reopened.read(otherAccount), null);
	assert.equal(await reopened.read(otherLecture), null);
	await reopened.write(otherAccount, { ...draft, content: "peer code" });
	await reopened.write(otherLecture, { ...draft, content: "other code" });
	const update = {
		content: "const latest = 2;",
		broadcastRevision: 3,
		updatedAt: 11,
	};
	await reopened.write(original, update);
	assert.deepEqual(await store.read(original), update);
	await reopened.remove(original);
	assert.equal(await store.read(original), null);
	assert.equal((await store.read(otherAccount)).content, "peer code");
	assert.equal((await store.read(otherLecture)).content, "other code");
	await reopened.removeAccount(otherAccount.uid);
	assert.equal(await store.read(otherAccount), null);
	assert.equal((await store.read(otherLecture)).content, "other code");
});
