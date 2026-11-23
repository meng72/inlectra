import { createHash } from "node:crypto";
import type { Database } from "firebase-admin/database";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
	changeBroadcast,
	changeCodeSubmission,
} from "./broadcast-transitions.js";
import { broadcastRequest, codeRequest } from "./broadcast.js";
import type { SessionId } from "./contract.js";
import { admission, authorize, type LectureSession } from "./session.js";

function digest(value: unknown) {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function broadcastCallables({
	db,
	region,
	findSession,
	openAdmission,
}: {
	db: Database;
	region: string;
	findSession: (id: SessionId) => Promise<LectureSession>;
	openAdmission: (session: LectureSession) => unknown;
}) {
	const mutateBroadcast = onCall({ region }, async (request) => {
		const actor = authorize(request.auth, true);
		if (actor.kind !== "accepted")
			throw new HttpsError(actor.kind, "Sign in as an instructor.");
		const parsed = broadcastRequest.safeParse(request.data);
		if (!parsed.success)
			throw new HttpsError(
				"invalid-argument",
				"Check the broadcast content and highlighted lines.",
			);
		const input = parsed.data;
		const session = await findSession(input.id);
		if (session.instructorUid !== actor.identity.uid)
			throw new HttpsError(
				"permission-denied",
				"Only the lecture owner can broadcast.",
			);
		const fingerprint = digest([input.expectedRevision, input.command]);
		const initial =
			session.state === "open" ? openAdmission(session) : { state: "archived" };
		let outcome: ReturnType<typeof changeBroadcast> | undefined;
		await db.ref(`admissions/${input.id}`).transaction((current: unknown) => {
			const room = admission.parse(current ?? initial);
			outcome = changeBroadcast({
				control: room.broadcastControl,
				request: input,
				fingerprint,
				state: room.state,
			});
			if (room.state !== "open" || outcome.kind !== "accepted") return current;
			const { broadcast: _previous, ...live } = room.live;
			return {
				...room,
				broadcastControl: outcome.control,
				live: outcome.control.document
					? { ...live, broadcast: outcome.control.document }
					: live,
			};
		});
		if (outcome?.kind === "accepted" || outcome?.kind === "replay")
			return outcome.receipt;
		throw new HttpsError(
			outcome?.kind ?? "internal",
			"The broadcast could not be changed. Check the latest lecture state.",
		);
	});

	const submitCode = onCall({ region }, async (request) => {
		const actor = authorize(request.auth, false);
		if (actor.kind !== "accepted")
			throw new HttpsError(
				actor.kind,
				"Sign in with a verified Google account.",
			);
		const parsed = codeRequest.safeParse(request.data);
		if (!parsed.success)
			throw new HttpsError("invalid-argument", "Check the code submission.");
		const input = parsed.data;
		const { uid, token } = actor.identity;
		const fingerprint = digest([
			input.broadcastRevision,
			input.expectedRevision,
			input.content,
		]);
		const now = Date.now();
		let outcome: ReturnType<typeof changeCodeSubmission> | undefined;
		await db.ref(`admissions/${input.id}`).transaction((current: unknown) => {
			if (current === null) {
				outcome = undefined;
				return current;
			}
			const room = admission.parse(current);
			const records = room.codeSubmissions ?? {};
			outcome = changeCodeSubmission({
				control: room.broadcastControl,
				previous: Object.hasOwn(records, uid) ? records[uid] : undefined,
				member: Object.hasOwn(room.members ?? {}, uid),
				request: input,
				fingerprint,
				now,
				email: token.email,
				state: room.state,
			});
			if (outcome.kind !== "accepted") return current;
			return {
				...room,
				codeSubmissions: { ...records, [uid]: outcome.submission },
			};
		});
		if (outcome?.kind === "accepted" || outcome?.kind === "replay")
			return outcome.receipt;
		throw new HttpsError(
			outcome?.kind ?? "not-found",
			"The code submission could not be accepted. Check the lecture and broadcast.",
		);
	});
	return { mutateBroadcast, submitCode };
}
