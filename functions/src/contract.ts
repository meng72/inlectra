import { z } from "zod";

export const firebaseUid = z
	.string()
	.min(1)
	.regex(/^[^.#$[\]/\p{Cc}]+$/u)
	.brand<"FirebaseUid">();
export const sessionId = z
	.string()
	.regex(/^[A-F0-9]{12}$/)
	.brand<"SessionId">();
export const createdSession = z.object({
	id: sessionId,
	joinCode: sessionId,
	title: z.string(),
	courseId: z.lazy(() => courseId),
	courseNumber: z.lazy(() => courseNumber),
	semester: z.lazy(() => semester),
});
export type CreatedSession = z.infer<typeof createdSession>;
export const operationId = z.uuid().brand<"OperationId">();
export const courseId = z.uuid().brand<"CourseId">();
export const courseNumber = z.string().trim().min(1).max(40);
export const semester = z.string().trim().min(1).max(40);
export const course = z.strictObject({
	id: courseId,
	instructorUid: firebaseUid,
	courseNumber,
	semester,
	createdAt: z.number().int().nonnegative(),
	operationId,
});
export const createCourseRequest = z.strictObject({
	courseNumber,
	semester,
	operationId,
});
export type Course = z.infer<typeof course>;
export type CourseId = z.infer<typeof courseId>;
export const codeInput = z.string().trim().toUpperCase().pipe(sessionId);
export const memberReceipt = z.object({ id: sessionId, joinedAt: z.number() });
export const ownerSession = createdSession.extend({
	state: z.enum(["open", "archived"]),
});
export const courseLectureSummary = ownerSession.extend({
	createdAt: z.number().int().nonnegative(),
});
export type CourseLectureSummary = z.infer<typeof courseLectureSummary>;
export type SessionId = z.infer<typeof sessionId>;
export type OwnerSession = z.infer<typeof ownerSession>;
