import { randomUUID } from "node:crypto";
import type { Database } from "firebase-admin/database";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
	course,
	courseId,
	createCourseRequest,
	type Course,
	type CourseId,
} from "./contract.js";
import { authorize } from "./session.js";

function requireInstructor(auth: unknown) {
	const actor = authorize(auth, true);
	if (actor.kind !== "accepted")
		throw new HttpsError(actor.kind, "Sign in with an instructor account.");
	return actor.identity.uid;
}

export function courseCallables({ db, region }: { db: Database; region: string }) {
	const createCourse = onCall({ region }, async (request) => {
		const instructorUid = requireInstructor(request.auth);
		const input = createCourseRequest.safeParse(request.data);
		if (!input.success)
			throw new HttpsError("invalid-argument", "Enter a course number and semester.");
		const { courseNumber, semester, operationId } = input.data;
		const slot = db.ref(`createCourseOperations/${instructorUid}/${operationId}`);
		const candidate: Course = {
			id: courseId.parse(randomUUID()),
			instructorUid,
			courseNumber,
			semester,
			createdAt: Date.now(),
			operationId,
		};
		const reserved = await slot.transaction((current) => current ?? candidate);
		const chosen = course.parse(reserved.snapshot.val());
		if (
			chosen.instructorUid !== instructorUid ||
			chosen.courseNumber !== courseNumber ||
			chosen.semester !== semester
		)
			throw new HttpsError(
				"already-exists",
				"That request already created a different course workspace.",
			);
		const saved = await db
			.ref(`courses/${instructorUid}/${chosen.id}`)
			.transaction((current) => current ?? chosen);
		return course.parse(saved.snapshot.val());
	});

	async function findOwnedCourse(uid: string, id: CourseId) {
		const snapshot = await db.ref(`courses/${uid}/${id}`).get();
		if (!snapshot.exists())
			throw new HttpsError("not-found", "That course workspace is unavailable.");
		const stored = course.parse(snapshot.val());
		if (stored.instructorUid !== uid)
			throw new HttpsError("permission-denied", "You do not own that course workspace.");
		return stored;
	}

	return { createCourse, findOwnedCourse };
}
