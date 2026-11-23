import { after, before, test } from "node:test";
import {
	assertFails,
	assertSucceeds,
	initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { get, ref, set } from "firebase/database";

let env;
const projectId = "demo-inlectra";
const owner = "fixture-instructor";
const claims = {
	instructor: true,
	email_verified: true,
	email: "teacher@example.test",
	firebase: { sign_in_provider: "google.com" },
};
const path = "sessions/AAFF00112233";
const dbURL = "http://127.0.0.1:9000?ns=demo-inlectra-default-rtdb";
const session = { title: "Demo lecture", instructorUid: owner, state: "open" };
const client = (uid, token = claims) =>
	env.authenticatedContext(uid, token).database(dbURL);

before(async () => {
	env = await initializeTestEnvironment({
		projectId,
		database: { host: "127.0.0.1", port: 9000 },
	});
	await env.withSecurityRulesDisabled((c) =>
		set(ref(c.database(dbURL), path), session),
	);
});
after(async () => {
	await env?.cleanup();
});

test("the owner can read a session but cannot write sessions directly", async () => {
	const own = client(owner);
	await assertSucceeds(get(ref(own, path)));
	await assertFails(set(ref(own, path), session));
	await assertFails(set(ref(own, "sessions/DEADBEEF0123"), session));
});

test("access is private to the verified Google instructor who owns the lecture", async () => {
	for (const db of [
		env.unauthenticatedContext().database(dbURL),
		client("other-instructor"),
		client(owner, { ...claims, instructor: false }),
		client(owner, { ...claims, email_verified: false }),
		client(owner, { ...claims, firebase: { sign_in_provider: "password" } }),
	]) {
		await assertFails(get(ref(db, path)));
	}
});

test("clients cannot enumerate sessions or read and write private records", async () => {
	const db = client(owner);
	for (const node of [
		"sessions",
		"submissions",
		"grades",
		"answerKeys",
		"reportEmails",
		"reporting",
		"createOperations",
		"createCourseOperations",
		"courseLectures",
		"admissions",
	]) {
		await assertFails(get(ref(db, node)));
		await assertFails(set(ref(db, `${node}/fixture`), true));
	}
});

test("only an instructor can read their course lecture index", async () => {
	const courseId = "11111111-1111-4111-8111-111111111111";
	const index = `courseLectures/${owner}/${courseId}`;
	await env.withSecurityRulesDisabled((ctx) =>
		set(ref(ctx.database(dbURL), `${index}/AAFF00112233`), {
			id: "AAFF00112233",
			state: "archived",
		}),
	);
	await assertSucceeds(get(ref(client(owner), index)));
	await assertFails(get(ref(client("other-instructor"), index)));
	await assertFails(
		get(ref(client(owner, { ...claims, instructor: false }), index)),
	);
	await assertFails(set(ref(client(owner), `${index}/AAFF00112233`), null));
});

test("the live view requires verified Google membership and remains read-only", async () => {
	const room = "admissions/001122AABBCC";
	const student = "fixture-student";
	const path = `${room}/live`;
	await env.withSecurityRulesDisabled((ctx) =>
		set(ref(ctx.database(dbURL), room), {
			state: "open",
			live: { title: "Live lecture" },
			members: { [student]: { joinedAt: 1, email: "learner@example.test" } },
		}),
	);
	const verified = { ...claims, instructor: false };
	await assertSucceeds(get(ref(client(student, verified), path)));
	await assertFails(
		set(ref(client(student, verified), path), { title: "changed" }),
	);
	await assertFails(
		set(ref(client(student, verified), `${room}/members/${student}`), {
			joinedAt: 2,
		}),
	);
	for (const identity of [
		client(student, { ...verified, email_verified: false }),
		client(student, {
			...verified,
			firebase: { sign_in_provider: "password" },
		}),
		client(owner),
		env.unauthenticatedContext().database(dbURL),
	])
		await assertFails(get(ref(identity, path)));
	await env.withSecurityRulesDisabled((ctx) =>
		set(ref(ctx.database(dbURL), `${room}/state`), "archived"),
	);
	await assertFails(get(ref(client(student, verified), path)));
});

test("only the verified instructor can read their private question bank", async () => {
	const courseId = "11111111-1111-4111-8111-111111111111";
	const bank = `questionBanks/${courseId}`;
	await env.withSecurityRulesDisabled(async (ctx) => {
		const database = ctx.database(dbURL);
		await set(ref(database, `courses/${owner}/${courseId}`), {
			id: courseId,
			instructorUid: owner,
			courseNumber: "CSE 4333",
			semester: "Fall 2026",
		});
		await set(ref(database, `${bank}/fixture`), { correctAnswer: "A" });
	});
	await assertSucceeds(get(ref(client(owner), `courses/${owner}`)));
	await assertSucceeds(get(ref(client(owner), bank)));
	await assertFails(get(ref(client("other-instructor"), bank)));
	await assertFails(
		get(ref(client(owner, { ...claims, instructor: false }), bank)),
	);
	await assertFails(set(ref(client(owner), `${bank}/fixture`), null));
});

test("an open lecture member can read only their own accepted answer", async () => {
	const room = "admissions/AAFF00112233";
	const uid = "answer-member";
	const peer = "peer-member";
	const response = `${room}/questionActivity/question/responses/${uid}`;
	await env.withSecurityRulesDisabled(async (ctx) => {
		const db = ctx.database(dbURL);
		await set(ref(db, room), {
			state: "open",
			members: {
				[uid]: { joinedAt: 1, email: "learner@example.test" },
				[peer]: { joinedAt: 1, email: "peer@example.test" },
			},
			questionActivity: {
				question: {
					responses: {
						[uid]: {
							accepted: { revision: 1, participationPoint: 1 },
							email: "learner@example.test",
						},
					},
				},
			},
		});
	});
	const student = client(uid, { ...claims, instructor: false });
	await assertSucceeds(get(ref(student, `${response}/accepted`)));
	await assertFails(get(ref(student, response)));
	await assertFails(get(ref(student, `${response}/email`)));
	await assertFails(get(ref(client(owner), `${response}/accepted`)));
	await assertFails(
		get(
			ref(
				client(peer, { ...claims, instructor: false }),
				`${response}/accepted`,
			),
		),
	);
	await assertFails(set(ref(student, `${response}/accepted`), { revision: 2 }));
	await env.withSecurityRulesDisabled((ctx) =>
		set(ref(ctx.database(dbURL), `${room}/state`), "archived"),
	);
	await assertFails(get(ref(student, `${response}/accepted`)));
});

test("an open lecture member can read only their accepted code", async () => {
	const room = "admissions/001122CCDDFF";
	const uid = "code-member";
	const path = `${room}/codeSubmissions/${uid}`;
	await env.withSecurityRulesDisabled((ctx) =>
		set(ref(ctx.database(dbURL), room), {
			state: "open",
			members: { [uid]: { joinedAt: 1 }, peer: { joinedAt: 1 } },
			codeSubmissions: {
				[uid]: {
					accepted: { content: "print(1)" },
					email: "student@example.test",
					operations: { fixture: true },
				},
			},
		}),
	);
	const student = client(uid, { ...claims, instructor: false });
	await assertSucceeds(get(ref(student, `${path}/accepted`)));
	for (const target of [path, `${path}/email`, `${path}/operations`])
		await assertFails(get(ref(student, target)));
	await assertFails(get(ref(client("peer"), `${path}/accepted`)));
	await assertFails(get(ref(client(owner), `${path}/accepted`)));
	await assertFails(set(ref(student, `${path}/accepted`), "replacement"));
	await env.withSecurityRulesDisabled((ctx) =>
		set(ref(ctx.database(dbURL), `${room}/state`), "archived"),
	);
	await assertFails(get(ref(student, `${path}/accepted`)));
});

test("student questions are private to their author and lecture owner", async () => {
	const id = "112233AABBCC";
	const room = `admissions/${id}`;
	const uid = "question-author";
	const peer = "question-peer";
	const questionId = "3a2558c1-551c-4b07-98c6-7a712951216e";
	await env.withSecurityRulesDisabled(async (ctx) => {
		const db = ctx.database(dbURL);
		await set(ref(db, `sessions/${id}`), {
			title: "Question inbox",
			instructorUid: owner,
			state: "open",
		});
		await set(ref(db, room), {
			state: "open",
			live: {
				title: "Question inbox",
				studentQuestions: [
					{
						id: questionId,
						text: "Published without identity",
						publishedAt: 2,
						answered: false,
					},
				],
			},
			members: {
				[uid]: { joinedAt: 1, email: "author@example.test" },
				[peer]: { joinedAt: 1, email: "peer@example.test" },
			},
			studentQuestions: {
				[uid]: {
					[questionId]: {
						id: questionId,
						authorUid: uid,
						authorEmail: "author@example.test",
						text: "Published without identity",
						reviewState: "open",
						visibility: "published",
						revision: 2,
						createdAt: 1,
						updatedAt: 2,
						publishedAt: 2,
					},
				},
			},
			studentQuestionOperations: { [uid]: { private: true } },
		});
	});
	const author = client(uid, { ...claims, instructor: false });
	const otherStudent = client(peer, { ...claims, instructor: false });
	await assertSucceeds(get(ref(author, `${room}/studentQuestions/${uid}`)));
	await assertFails(get(ref(author, `${room}/studentQuestions`)));
	await assertFails(
		get(ref(otherStudent, `${room}/studentQuestions/${uid}`)),
	);
	await assertFails(get(ref(author, `${room}/studentQuestionOperations`)));
	await assertSucceeds(get(ref(client(owner), `${room}/studentQuestions`)));
	await assertSucceeds(get(ref(otherStudent, `${room}/live`)));
	await assertFails(
		set(ref(author, `${room}/studentQuestions/${uid}/${questionId}/text`), "x"),
	);
	await env.withSecurityRulesDisabled((ctx) =>
		set(ref(ctx.database(dbURL), `${room}/state`), "archived"),
	);
	await assertFails(get(ref(author, `${room}/studentQuestions/${uid}`)));
	await assertSucceeds(get(ref(client(owner), `${room}/studentQuestions`)));
});
