import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
	createStudentQuestion,
	reviewStudentQuestion,
	reviseStudentQuestion,
	withdrawStudentQuestion,
} from "../functions/lib/student-question-transitions.js";

const principal = {
	uid: "student-one",
	email: "student@example.test",
	displayName: "Student One",
};

test("student questions can be revised or withdrawn only while private and open", () => {
	const questionId = randomUUID();
	const created = createStudentQuestion({
		questionId,
		principal,
		text: "  Could you explain the second step?  ",
		now: 100,
	});
	assert.equal(created.kind, "accepted");
	assert.deepEqual(created.record, {
		id: questionId,
		authorUid: principal.uid,
		authorEmail: principal.email,
		authorDisplayName: principal.displayName,
		text: "Could you explain the second step?",
		reviewState: "open",
		visibility: "private",
		revision: 1,
		createdAt: 100,
		updatedAt: 100,
	});

	const revised = reviseStudentQuestion({
		record: created.record,
		expectedRevision: 1,
		text: "Could you revisit the second step?",
		now: 200,
	});
	assert.equal(revised.kind, "accepted");
	assert.equal(revised.record.revision, 2);
	assert.equal(revised.record.text, "Could you revisit the second step?");
	assert.equal(
		reviseStudentQuestion({
			record: revised.record,
			expectedRevision: 1,
			text: "Stale change",
			now: 300,
		}).kind,
		"aborted",
	);
	const withdrawn = withdrawStudentQuestion({
		record: revised.record,
		expectedRevision: 2,
		now: 300,
	});
	assert.equal(withdrawn.kind, "accepted");
	assert.equal(withdrawn.record.reviewState, "withdrawn");
	assert.equal(
		reviseStudentQuestion({
			record: withdrawn.record,
			expectedRevision: 3,
			text: "Too late",
			now: 400,
		}).kind,
		"failed-precondition",
	);
});

test("instructor review publishes only sanitized content and can answer or dismiss it", () => {
	const created = createStudentQuestion({
		questionId: randomUUID(),
		principal,
		text: "Will this be on the exam?",
		now: 100,
	});
	assert.equal(created.kind, "accepted");
	const published = reviewStudentQuestion({
		record: created.record,
		expectedRevision: 1,
		action: "publish",
		now: 200,
	});
	assert.equal(published.kind, "accepted");
	assert.equal(published.record.visibility, "published");
	assert.deepEqual(published.publicQuestion, {
		id: created.record.id,
		text: "Will this be on the exam?",
		publishedAt: 200,
		answered: false,
	});
	assert.equal("authorUid" in published.publicQuestion, false);
	assert.equal(
		reviseStudentQuestion({
			record: published.record,
			expectedRevision: 2,
			text: "Changed after publication",
			now: 300,
		}).kind,
		"failed-precondition",
	);

	const answered = reviewStudentQuestion({
		record: published.record,
		expectedRevision: 2,
		action: "answer",
		now: 300,
	});
	assert.equal(answered.kind, "accepted");
	assert.equal(answered.record.reviewState, "answered");
	assert.equal(answered.publicQuestion?.answered, true);

	const dismissed = reviewStudentQuestion({
		record: published.record,
		expectedRevision: 2,
		action: "dismiss",
		now: 300,
	});
	assert.equal(dismissed.kind, "accepted");
	assert.equal(dismissed.record.reviewState, "dismissed");
	assert.equal(dismissed.publicQuestion, undefined);
});
