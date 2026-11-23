import { initializeApp } from "firebase/app";
import {
	connectAuthEmulator,
	getAuth,
	GoogleAuthProvider,
	onIdTokenChanged,
	signInWithPopup,
	signOut,
} from "firebase/auth";
import {
	connectFunctionsEmulator,
	getFunctions,
	httpsCallable,
} from "firebase/functions";
import {
	connectDatabaseEmulator,
	get,
	getDatabase,
	onValue,
	ref,
} from "firebase/database";
import {
	acceptedResponse,
	questionStats,
	submissionReceipt,
	type QuestionStats,
	type SubmissionRequest,
} from "../functions/src/answers";
import {
	acceptedCode,
	broadcastControl,
	broadcastReceipt,
	codeReceipt,
	type BroadcastRequest,
	type BroadcastDocument,
	type CodeRequest,
} from "../functions/src/broadcast";
import {
	course,
	courseLectureSummary,
	type createCourseRequest,
	createdSession,
	memberReceipt,
	ownerSession,
	type Course,
	type CourseId,
	type CourseLectureSummary,
	type OwnerSession,
	type SessionId,
} from "../functions/src/contract";
import {
	createQuestionReceipt,
	type createQuestionRequest,
	emptyPlan,
	importReceipt,
	liveQuestions,
	type LiveLecture,
	planReceipt,
	type planRequest,
	questionContent,
	questionId,
	questionModifiedAtMap,
	questionPlan,
	questionRevisionMap,
	type QuestionContent,
	type QuestionId,
	type QuestionPlan,
	updateQuestionReceipt,
	type updateQuestionRequest,
} from "../functions/src/questions";
import {
	reportingSummary,
	reportResult,
	type rosterImportRequest,
	rosterReceipt,
} from "../functions/src/reporting";
import {
	studentQuestionReceipt,
	studentQuestionRecordMap,
	studentQuestionRecords,
	type StudentQuestionRecord,
	type StudentQuestionRequest,
	type StudentQuestionReviewRequest,
} from "../functions/src/student-questions";
import type { z } from "zod";
import { createDraftStore } from "./codeDraftStore";

const app = initializeApp({
	projectId: "demo-inlectra",
	apiKey: "demo-key",
	authDomain: "demo-inlectra.firebaseapp.com",
	databaseURL: "https://demo-inlectra-default-rtdb.firebaseio.com",
});
const database = getDatabase(app);
connectDatabaseEmulator(database, "127.0.0.1", 9000);
export const auth = getAuth(app);
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
const functions = getFunctions(app, "us-central1");
connectFunctionsEmulator(functions, "127.0.0.1", 5001);

export type Identity =
	| { kind: "loading" | "signed-out" | "ineligible" | "unavailable" }
	| { kind: "student" | "instructor"; uid: string; email: string };

export function observeIdentity(set: (identity: Identity) => void) {
	let generation = 0;
	const unsubscribe = onIdTokenChanged(auth, async (user) => {
		const current = ++generation;
		if (!user) {
			set({ kind: "signed-out" });
			return;
		}
		set({ kind: "loading" });
		try {
			const token = await user.getIdTokenResult();
			if (current !== generation) return;
			if (
				!user.email ||
				token.claims.email_verified !== true ||
				token.signInProvider !== "google.com"
			) {
				set({ kind: "ineligible" });
				return;
			}
			set({
				kind: token.claims.instructor === true ? "instructor" : "student",
				uid: user.uid,
				email: user.email,
			});
		} catch {
			if (current === generation) set({ kind: "unavailable" });
		}
	});
	return () => {
		generation++;
		unsubscribe();
	};
}

export const signIn = () => signInWithPopup(auth, new GoogleAuthProvider());
export async function leave() {
	if (auth.currentUser) {
		await createDraftStore(indexedDB).removeAccount(auth.currentUser.uid);
	}
	await signOut(auth);
}

const createCourseCall = httpsCallable<
	z.infer<typeof createCourseRequest>,
	unknown
>(functions, "createCourse");
export async function createCourseWorkspace(
	input: z.infer<typeof createCourseRequest>,
) {
	return course.parse((await createCourseCall(input)).data);
}
export function watchCourses(uid: string, show: (courses: Course[]) => void) {
	return onValue(
		ref(database, `courses/${uid}`),
		(snapshot) => {
			const courses: Course[] = [];
			snapshot.forEach((child) => {
				const parsed = course.safeParse(child.val());
				if (parsed.success) courses.push(parsed.data);
			});
			show(courses.sort((a, b) => b.createdAt - a.createdAt));
		},
		() => show([]),
	);
}
export function watchCourseLectures(
	uid: string,
	courseId: CourseId,
	show: (lectures: CourseLectureSummary[]) => void,
) {
	return onValue(
		ref(database, `courseLectures/${uid}/${courseId}`),
		(snapshot) => {
			const lectures: CourseLectureSummary[] = [];
			snapshot.forEach((child) => {
				const parsed = courseLectureSummary.safeParse(child.val());
				if (parsed.success) lectures.push(parsed.data);
			});
			show(lectures.sort((a, b) => b.createdAt - a.createdAt));
		},
		() => show([]),
	);
}

const create = httpsCallable<
	{ title: string; operationId: string; courseId: CourseId },
	unknown
>(
	functions,
	"createSession",
);
export async function createLecture(
	title: string,
	operationId: string,
	courseId: CourseId,
) {
	return createdSession.parse(
		(await create({ title, operationId, courseId })).data,
	);
}
const join = httpsCallable<{ id: SessionId }, unknown>(
	functions,
	"joinSession",
);
const archive = httpsCallable<{ id: SessionId }, unknown>(
	functions,
	"archiveSession",
);
const removeLecture = httpsCallable<
	{ id: SessionId; confirmation: SessionId },
	unknown
>(functions, "deleteLectureData");
export async function joinLecture(id: SessionId) {
	return memberReceipt.parse((await join({ id })).data);
}
export async function archiveLecture(id: SessionId) {
	await archive({ id });
}
export async function deleteLectureData(id: SessionId) {
	await removeLecture({ id, confirmation: id });
}
export function watchOwner(
	id: SessionId,
	show: (session: OwnerSession | null) => void,
) {
	return onValue(
		ref(database, `sessions/${id}`),
		(snapshot) => {
			const result = ownerSession.safeParse(snapshot.val());
			show(result.success ? result.data : null);
		},
		() => show(null),
	);
}
export function watchLiveLecture(
	id: SessionId,
	show: (lecture: LiveLecture | null) => void,
) {
	return onValue(
		ref(database, `admissions/${id}/live`),
		(snapshot) => {
			const result = liveQuestions.safeParse(snapshot.val());
			show(result.success ? result.data : null);
		},
		() => show(null),
	);
}

export type BankQuestion = {
	id: QuestionId;
	revision: number;
	modifiedAt: number;
	question: QuestionContent;
};

export function watchQuestionBank(
	courseId: CourseId,
	show: (bank: BankQuestion[] | null) => void,
) {
	return onValue(
		ref(database, `questionBanks/${courseId}`),
		(snapshot) => {
			const bank: BankQuestion[] = [];
			const revisions = questionRevisionMap.safeParse(
				snapshot.child("_questionRevisions").val() ?? {},
			);
			const modifiedAt = questionModifiedAtMap.safeParse(
				snapshot.child("_questionModifiedAt").val() ?? {},
			);
			let malformed = !revisions.success || !modifiedAt.success;
			snapshot.forEach((child) => {
				const id = questionId.safeParse(child.key);
				if (!id.success) return;
				const question = questionContent.safeParse(child.val());
				if (question.success)
					bank.push({
						id: id.data,
						revision: revisions.success ? (revisions.data[id.data] ?? 0) : 0,
						modifiedAt: modifiedAt.success
							? (modifiedAt.data[id.data] ?? 0)
							: 0,
						question: question.data,
					});
				else malformed = true;
			});
			show(
				malformed
					? null
					: bank.sort(
							(a, b) => b.modifiedAt - a.modifiedAt || a.id.localeCompare(b.id),
						),
			);
		},
		() => show(null),
	);
}

export function watchQuestionPlan(
	id: SessionId,
	show: (plan: QuestionPlan | null) => void,
) {
	return onValue(
		ref(database, `admissions/${id}/control`),
		(snapshot) => {
			const result = questionPlan.safeParse(snapshot.val() ?? emptyPlan);
			show(result.success ? result.data : null);
		},
		() => show(null),
	);
}

const importRows = httpsCallable<
	{ courseId: CourseId; rows: string[][]; operationId: string },
	unknown
>(functions, "importQuestions");
export async function importBankQuestions(
	rows: string[][],
	operationId: string,
	courseId: CourseId,
) {
	return importReceipt.parse(
		(await importRows({ rows, operationId, courseId })).data,
	)
		.ids;
}

const createRow = httpsCallable<z.infer<typeof createQuestionRequest>, unknown>(
	functions,
	"createQuestion",
);
export async function createBankQuestion(
	input: z.infer<typeof createQuestionRequest>,
) {
	return createQuestionReceipt.parse((await createRow(input)).data);
}

const deleteRow = httpsCallable<{ courseId: CourseId; id: QuestionId }, unknown>(
	functions,
	"deleteQuestion",
);
export async function deleteBankQuestion(courseId: CourseId, id: QuestionId) {
	await deleteRow({ courseId, id });
}

const updateRow = httpsCallable<z.infer<typeof updateQuestionRequest>, unknown>(
	functions,
	"updateQuestion",
);
export async function updateBankQuestion(
	input: z.infer<typeof updateQuestionRequest>,
) {
	return updateQuestionReceipt.parse((await updateRow(input)).data);
}

const changePlan = httpsCallable<z.infer<typeof planRequest>, unknown>(
	functions,
	"mutateQuestionPlan",
);
export async function mutateQuestionPlan(input: z.infer<typeof planRequest>) {
	return planReceipt.parse((await changePlan(input)).data);
}

const sendAnswer = httpsCallable<SubmissionRequest, unknown>(
	functions,
	"submitAnswer",
);
export async function submitAnswer(input: SubmissionRequest) {
	return submissionReceipt.parse((await sendAnswer(input)).data);
}

export async function readOwnAnswer(
	id: SessionId,
	questionId: QuestionId,
	uid: string,
) {
	const snapshot = await get(
		ref(
			database,
			`admissions/${id}/questionActivity/${questionId}/responses/${uid}/accepted`,
		),
	);
	return snapshot.exists() ? acceptedResponse.parse(snapshot.val()) : null;
}

export function watchQuestionStats(
	id: SessionId,
	questionId: QuestionId,
	show: (stats: QuestionStats | null | "unavailable") => void,
) {
	return onValue(
		ref(
			database,
			`admissions/${id}/questionActivity/${questionId}/publicStats`,
		),
		(snapshot) => {
			if (!snapshot.exists()) {
				show(null);
				return;
			}
			const parsed = questionStats.safeParse(snapshot.val());
			show(parsed.success ? parsed.data : "unavailable");
		},
		() => show("unavailable"),
	);
}

const sendBroadcast = httpsCallable<BroadcastRequest, unknown>(
	functions,
	"mutateBroadcast",
);
const sendCode = httpsCallable<CodeRequest, unknown>(functions, "submitCode");

export async function mutateBroadcast(input: BroadcastRequest) {
	return broadcastReceipt.parse((await sendBroadcast(input)).data);
}

export async function submitCode(input: CodeRequest) {
	return codeReceipt.parse((await sendCode(input)).data);
}

export function watchBroadcastControl(
	id: SessionId,
	show: (
		value: {
			revision: number;
			document?: BroadcastDocument;
		} | null,
	) => void,
) {
	return onValue(
		ref(database, `admissions/${id}/broadcastControl`),
		(snapshot) => {
			if (!snapshot.exists()) {
				show({ revision: 0 });
				return;
			}
			const value = broadcastControl.safeParse(snapshot.val());
			show(
				value.success
					? { revision: value.data.revision, document: value.data.document }
					: null,
			);
		},
		() => show(null),
	);
}

export async function readOwnCode(id: SessionId, uid: string) {
	const snapshot = await get(
		ref(database, `admissions/${id}/codeSubmissions/${uid}/accepted`),
	);
	return snapshot.exists() ? acceptedCode.parse(snapshot.val()) : null;
}

const uploadRoster = httpsCallable<
	z.infer<typeof rosterImportRequest>,
	unknown
>(functions, "importRoster");
const readReportingSummary = httpsCallable<{ id: SessionId }, unknown>(
	functions,
	"getReportingSummary",
);
const generateReport = httpsCallable<
	{ id: SessionId; kind: "participation" | "canvas" },
	unknown
>(functions, "createReport");

export async function importRoster(input: z.infer<typeof rosterImportRequest>) {
	return rosterReceipt.parse((await uploadRoster(input)).data);
}

export async function getReportingSummary(id: SessionId) {
	return reportingSummary.parse((await readReportingSummary({ id })).data);
}

export async function createReport(
	id: SessionId,
	kind: "participation" | "canvas",
) {
	return reportResult.parse((await generateReport({ id, kind })).data);
}

const changeStudentQuestion = httpsCallable<StudentQuestionRequest, unknown>(
	functions,
	"mutateStudentQuestion",
);
const moderateStudentQuestion = httpsCallable<
	StudentQuestionReviewRequest,
	unknown
>(functions, "reviewStudentQuestion");

export async function mutateStudentQuestion(input: StudentQuestionRequest) {
	return studentQuestionReceipt.parse(
		(await changeStudentQuestion(input)).data,
	);
}

export async function reviewStudentQuestion(
	input: StudentQuestionReviewRequest,
) {
	return studentQuestionReceipt.parse(
		(await moderateStudentQuestion(input)).data,
	);
}

function newestStudentQuestions(records: StudentQuestionRecord[]) {
	return records.sort(
		(a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id),
	);
}

export function watchOwnStudentQuestions(
	id: SessionId,
	uid: string,
	show: (questions: StudentQuestionRecord[] | null) => void,
) {
	return onValue(
		ref(database, `admissions/${id}/studentQuestions/${uid}`),
		(snapshot) => {
			const parsed = studentQuestionRecordMap.safeParse(snapshot.val() ?? {});
			show(
				parsed.success
					? newestStudentQuestions(Object.values(parsed.data))
					: null,
			);
		},
		() => show(null),
	);
}

export function watchStudentQuestionInbox(
	id: SessionId,
	show: (questions: StudentQuestionRecord[] | null) => void,
) {
	return onValue(
		ref(database, `admissions/${id}/studentQuestions`),
		(snapshot) => {
			const parsed = studentQuestionRecords.safeParse(snapshot.val() ?? {});
			show(
				parsed.success
					? newestStudentQuestions(
							Object.values(parsed.data ?? {}).flatMap((records) =>
								Object.values(records),
							),
						)
					: null,
			);
		},
		() => show(null),
	);
}
