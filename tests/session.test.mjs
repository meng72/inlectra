import assert from "node:assert/strict";
import test from "node:test";
import {
	accessRequest,
	joinDecision,
	sessionRequest,
} from "../functions/lib/session.js";
import { randomUUID } from "node:crypto";
const operationId = randomUUID();
const courseId = randomUUID();

const instructor = {
	uid: "synthetic-instructor",
	token: {
		email: "instructor@example.test",
		email_verified: true,
		instructor: true,
		firebase: { sign_in_provider: "google.com" },
	},
};

test("a verified Google instructor can create a titled session", () => {
	assert.deepEqual(
		sessionRequest(instructor, { title: "  Lab 1  ", operationId, courseId }),
		{
			kind: "accepted",
			operationId,
			courseId,
			title: "Lab 1",
			instructorUid: instructor.uid,
		},
	);
});

test("a signed-out request must sign in", () => {
	assert.equal(
		sessionRequest(undefined, { title: "Lab" }).kind,
		"unauthenticated",
	);
});

for (const [label, claims] of Object.entries({
	student: { instructor: false },
	unverified: { email_verified: false },
	"missing email": { email: undefined },
	"different provider": { firebase: { sign_in_provider: "password" } },
})) {
	test(`rejects the ${label} identity`, () => {
		const auth = { ...instructor, token: { ...instructor.token, ...claims } };
		assert.equal(
			sessionRequest(auth, { title: "Lab" }).kind,
			"permission-denied",
		);
	});
}

for (const input of [
	{ title: "  ", operationId },
	{ title: "a".repeat(121), operationId },
	{ title: "Lab", instructorUid: "other", operationId },
	{ title: "Lab", operationId: "invalid" },
	{ title: "Lab", operationId, courseId: "invalid" },
	{ title: "Lab", operationId },
	null,
]) {
	test(`rejects invalid lecture input ${JSON.stringify(input)}`, () => {
		assert.equal(sessionRequest(instructor, input).kind, "invalid-argument");
	});
}

test("an eligible student can join with a padded lowercase code", () => {
	const student = {
		...instructor,
		token: { ...instructor.token, instructor: false },
	};
	const input = { id: "  abcdef123456 " };
	assert.deepEqual(accessRequest(student, input, "join"), {
		kind: "accepted",
		id: "ABCDEF123456",
		uid: student.uid,
		email: student.token.email,
	});
	assert.equal(
		accessRequest(student, input, "archive").kind,
		"permission-denied",
	);
	for (const action of ["join", "archive"]) {
		assert.equal(
			accessRequest(undefined, input, action).kind,
			"unauthenticated",
		);
		assert.equal(
			accessRequest(instructor, { id: "!" }, action).kind,
			"invalid-argument",
		);
		assert.equal(
			accessRequest(
				{
					...instructor,
					token: { ...instructor.token, email_verified: false },
				},
				input,
				action,
			).kind,
			"permission-denied",
		);
	}
});

test("expiry stops new admissions at the boundary and archive stops every member", () => {
	const room = {
		state: "open",
		joinExpiresAt: 100,
		members: { member: { joinedAt: 1 } },
	};
	assert.equal(joinDecision(room, "new", 99), "admit");
	assert.equal(joinDecision(room, "new", 100), "expired");
	assert.equal(joinDecision(room, "member", 101), "member");
	assert.equal(joinDecision({ state: "archived" }, "member", 101), "closed");
});
