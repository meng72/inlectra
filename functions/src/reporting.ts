import { z } from "zod";
import type { QuestionActivity } from "./answers.js";
import { codeInput, operationId } from "./contract.js";
import type { QuestionPlan } from "./questions.js";
import type { Membership } from "./session.js";

export const rosterHeaders = [
	"email",
	"display_name",
	"canvas_identifier",
] as const;
export const maxRosterRows = 500;

const rosterEmail = z.string().trim().toLowerCase().pipe(z.email().max(320));
const optionalName = z
	.string()
	.trim()
	.max(200)
	.transform((value) => value || undefined);
const canvasIdentifier = z.string().trim().min(1).max(200);
export const rosterEntry = z.strictObject({
	email: rosterEmail,
	displayName: z.string().min(1).max(200).optional(),
	canvasIdentifier,
});
export type RosterEntry = z.infer<typeof rosterEntry>;

const rosterRow = z
	.tuple([z.string(), z.string(), z.string()])
	.transform(([email, displayName, identifier]) => ({
		email,
		displayName,
		canvasIdentifier: identifier,
	}))
	.pipe(
		z.strictObject({
			email: rosterEmail,
			displayName: optionalName,
			canvasIdentifier,
		}),
	)
	.transform(({ displayName, ...entry }) =>
		displayName ? { ...entry, displayName } : entry,
	);

export function validateRosterRows(rows: unknown[]) {
	const header = rows[0];
	if (
		rows.length < 2 ||
		rows.length > maxRosterRows + 1 ||
		!Array.isArray(header) ||
		header.length !== rosterHeaders.length ||
		!rosterHeaders.every((name, index) => header[index] === name)
	) {
		return {
			ok: false,
			errors: [
				`Use the header ${rosterHeaders.join(",")} and include 1 to ${maxRosterRows} records.`,
			],
		} as const;
	}
	const entries: RosterEntry[] = [];
	const errors: string[] = [];
	const emails = new Set<string>();
	const identifiers = new Set<string>();
	for (const [index, value] of rows.slice(1).entries()) {
		const parsed = rosterRow.safeParse(value);
		if (!parsed.success) {
			errors.push(
				`Record ${index + 2}: check the email and Canvas identifier.`,
			);
			continue;
		}
		const { email, canvasIdentifier } = parsed.data;
		if (emails.has(email))
			errors.push(`Record ${index + 2}: email appears more than once.`);
		if (identifiers.has(canvasIdentifier))
			errors.push(
				`Record ${index + 2}: Canvas identifier appears more than once.`,
			);
		emails.add(email);
		identifiers.add(canvasIdentifier);
		entries.push(parsed.data);
	}
	return errors.length
		? ({ ok: false, errors } as const)
		: ({ ok: true, entries } as const);
}

export const rosterReceipt = z.strictObject({
	revision: z.number().int().positive(),
	count: z.number().int().nonnegative(),
});
const rosterOperation = z.strictObject({
	fingerprint: z.string(),
	receipt: rosterReceipt,
});
export const rosterControl = z.strictObject({
	revision: z.number().int().nonnegative(),
	entries: z.array(rosterEntry),
	operations: z.record(z.string(), rosterOperation),
});
export type RosterControl = z.infer<typeof rosterControl>;

export const rosterImportRequest = z.strictObject({
	id: codeInput,
	operationId,
	expectedRevision: z.number().int().nonnegative(),
	rows: z
		.array(z.unknown())
		.min(2)
		.max(maxRosterRows + 1),
});
export type RosterImportRequest = z.infer<typeof rosterImportRequest>;
export type RosterChangeRequest = {
	operationId: z.infer<typeof operationId>;
	expectedRevision: number;
	entries: RosterEntry[];
};

export function changeRoster({
	control,
	request,
	fingerprint,
}: {
	control?: RosterControl;
	request: RosterChangeRequest;
	fingerprint: string;
}) {
	const prior = control?.operations[request.operationId];
	if (prior) {
		return prior.fingerprint === fingerprint
			? ({ kind: "replay", receipt: prior.receipt } as const)
			: ({ kind: "already-exists" } as const);
	}
	if ((control?.revision ?? 0) !== request.expectedRevision)
		return { kind: "aborted" } as const;
	const receipt = {
		revision: request.expectedRevision + 1,
		count: request.entries.length,
	};
	const next: RosterControl = {
		revision: receipt.revision,
		entries: request.entries,
		operations: {
			...control?.operations,
			[request.operationId]: { fingerprint, receipt },
		},
	};
	return { kind: "accepted", control: next, receipt } as const;
}

export const reportReference = z.strictObject({ id: codeInput });
export const reportRequest = reportReference.extend({
	kind: z.enum(["participation", "canvas"]),
});
const unmatchedReason = z.enum([
	"no-roster-match",
	"duplicate-participant-email",
]);
export const unmatchedAccount = z.strictObject({
	email: z.string(),
	displayName: z.string().optional(),
	reason: unmatchedReason,
});
export type UnmatchedAccount = z.infer<typeof unmatchedAccount>;
export const reportResult = z.strictObject({
	filename: z.string(),
	csv: z.string(),
	rowCount: z.number().int().nonnegative(),
	unmatched: z.array(unmatchedAccount),
});
export const reportingSummary = z.strictObject({
	rosterRevision: z.number().int().nonnegative(),
	rosterCount: z.number().int().nonnegative(),
	joinedCount: z.number().int().nonnegative(),
	participatingCount: z.number().int().nonnegative(),
	participationPoints: z.number().int().nonnegative(),
	generatedAt: z.number().int().positive(),
});
export type ReportingSummary = z.infer<typeof reportingSummary>;

function safeCsvCell(value: string) {
	const protectedValue = /^[\t\r\n ]*[=+@-]/.test(value) ? `'${value}` : value;
	return `"${protectedValue.replaceAll('"', '""')}"`;
}

function csv(rows: string[][]) {
	return `${rows.map((row) => row.map(safeCsvCell).join(",")).join("\r\n")}\r\n`;
}

export function buildReport({
	kind,
	members,
	plan,
	activity,
	roster = [],
}: {
	kind: "participation" | "canvas";
	members: Record<string, Membership>;
	plan: QuestionPlan;
	activity: Record<string, QuestionActivity>;
	roster?: RosterEntry[];
}) {
	const questions = plan.items.filter(
		({ question, state }) => question.graded && state !== "skipped",
	);
	const participants = Object.entries(members)
		.map(([uid, member]) => {
			const credits = questions.map(
				({ id }) =>
					activity[id]?.responses[uid]?.accepted.participationPoint ?? 0,
			);
			return {
				uid,
				...member,
				normalizedEmail: member.email.trim().toLowerCase(),
				credits,
				total: credits.reduce<number>((sum, credit) => sum + credit, 0),
			};
		})
		.sort(
			(a, b) =>
				a.normalizedEmail.localeCompare(b.normalizedEmail) ||
				a.uid.localeCompare(b.uid),
		);
	if (kind === "participation") {
		const rows = [
			[
				"email",
				"display_name",
				...questions.map((_, index) => `question_${index + 1}_credit`),
				"total",
			],
			...participants.map((participant) => [
				participant.email,
				participant.displayName ?? "",
				...participant.credits.map(String),
				String(participant.total),
			]),
		];
		return { csv: csv(rows), rowCount: participants.length, unmatched: [] };
	}
	const emailCounts = new Map<string, number>();
	for (const { normalizedEmail } of participants)
		emailCounts.set(
			normalizedEmail,
			(emailCounts.get(normalizedEmail) ?? 0) + 1,
		);
	const duplicateEmails = new Set(
		[...emailCounts].flatMap(([email, count]) => (count > 1 ? [email] : [])),
	);
	const rosterByEmail = new Map(roster.map((entry) => [entry.email, entry]));
	const unmatched: UnmatchedAccount[] = [];
	const matched: string[][] = [];
	for (const participant of participants) {
		const mapping = rosterByEmail.get(participant.normalizedEmail);
		const reason = duplicateEmails.has(participant.normalizedEmail)
			? "duplicate-participant-email"
			: mapping
				? undefined
				: "no-roster-match";
		if (reason) {
			unmatched.push({
				email: participant.email,
				...(participant.displayName
					? { displayName: participant.displayName }
					: {}),
				reason,
			});
		} else if (mapping) {
			matched.push([mapping.canvasIdentifier, String(participant.total)]);
		}
	}
	return {
		csv: csv([["canvas_identifier", "participation_score"], ...matched]),
		rowCount: matched.length,
		unmatched,
	};
}
