import { createHash } from "node:crypto";
import type { Database } from "firebase-admin/database";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
	buildReport,
	changeRoster,
	reportReference,
	reportRequest,
	rosterControl,
	rosterImportRequest,
	validateRosterRows,
} from "./reporting.js";
import { emptyPlan } from "./questions.js";
import { admission, authorize, type LectureSession } from "./session.js";
import type { SessionId } from "./contract.js";

function digest(value: unknown) {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function reportCallables({
	db,
	region,
	findSession,
}: {
	db: Database;
	region: string;
	findSession: (id: SessionId) => Promise<LectureSession>;
}) {
	async function ownedSession(auth: unknown, id: SessionId) {
		const actor = authorize(auth, true);
		if (actor.kind !== "accepted")
			throw new HttpsError(actor.kind, "Sign in as an instructor.");
		const session = await findSession(id);
		if (session.instructorUid !== actor.identity.uid)
			throw new HttpsError(
				"permission-denied",
				"Only the lecture owner can manage reports.",
			);
		return session;
	}

	const importRoster = onCall({ region }, async (request) => {
		const parsed = rosterImportRequest.safeParse(request.data);
		if (!parsed.success)
			throw new HttpsError("invalid-argument", "Check the roster CSV.");
		const { id, operationId, expectedRevision, rows } = parsed.data;
		await ownedSession(request.auth, id);
		const validated = validateRosterRows(rows);
		if (!validated.ok)
			throw new HttpsError("invalid-argument", validated.errors.join(" "));
		const changeRequest = {
			operationId,
			expectedRevision,
			entries: validated.entries,
		};
		const fingerprint = digest([expectedRevision, validated.entries]);
		let outcome: ReturnType<typeof changeRoster> | undefined;
		await db.ref(`reporting/${id}/roster`).transaction((current: unknown) => {
			const control =
				current === null ? undefined : rosterControl.parse(current);
			outcome = changeRoster({ control, request: changeRequest, fingerprint });
			return outcome.kind === "accepted" ? outcome.control : current;
		});
		if (outcome?.kind === "accepted" || outcome?.kind === "replay")
			return outcome.receipt;
		throw new HttpsError(
			outcome?.kind ?? "internal",
			"The roster changed. Reload its status before replacing it.",
		);
	});

	const getReportingSummary = onCall({ region }, async (request) => {
		const parsed = reportReference.safeParse(request.data);
		if (!parsed.success)
			throw new HttpsError("invalid-argument", "Check the lecture code.");
		await ownedSession(request.auth, parsed.data.id);
		const [roomSnapshot, rosterSnapshot] = await Promise.all([
			db.ref(`admissions/${parsed.data.id}`).get(),
			db.ref(`reporting/${parsed.data.id}/roster`).get(),
		]);
		if (!roomSnapshot.exists())
			throw new HttpsError("not-found", "The lecture is unavailable.");
		const room = admission.parse(roomSnapshot.val());
		const roster = rosterSnapshot.exists()
			? rosterControl.parse(rosterSnapshot.val())
			: undefined;
		const participants = new Set<string>();
		let participationPoints = 0;
		for (const activity of Object.values(room.questionActivity ?? {})) {
			for (const [uid, response] of Object.entries(activity.responses)) {
				participants.add(uid);
				participationPoints += response.accepted.participationPoint;
			}
		}
		return {
			rosterRevision: roster?.revision ?? 0,
			rosterCount: roster?.entries.length ?? 0,
			joinedCount: Object.keys(room.members ?? {}).length,
			participatingCount: participants.size,
			participationPoints,
			generatedAt: Date.now(),
		};
	});

	const createReport = onCall({ region }, async (request) => {
		const parsed = reportRequest.safeParse(request.data);
		if (!parsed.success)
			throw new HttpsError("invalid-argument", "Check the report request.");
		const { id, kind } = parsed.data;
		await ownedSession(request.auth, id);
		const [roomSnapshot, rosterSnapshot] = await Promise.all([
			db.ref(`admissions/${id}`).get(),
			db.ref(`reporting/${id}/roster`).get(),
		]);
		if (!roomSnapshot.exists())
			throw new HttpsError("not-found", "The lecture is unavailable.");
		const room = admission.parse(roomSnapshot.val());
		const roster = rosterSnapshot.exists()
			? rosterControl.parse(rosterSnapshot.val()).entries
			: [];
		const result = buildReport({
			kind,
			members: room.members ?? {},
			plan: room.control ?? emptyPlan,
			activity: room.questionActivity ?? {},
			roster,
		});
		return {
			...result,
			filename: `${kind === "canvas" ? "canvas" : "participation"}-${id}.csv`,
		};
	});

	return { importRoster, getReportingSummary, createReport };
}
