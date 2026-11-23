import type {
	BroadcastControl,
	BroadcastRequest,
	CodeRequest,
	CodeSubmission,
} from "./broadcast.js";

export function changeBroadcast({
	control,
	request,
	fingerprint,
	state,
}: {
	control?: BroadcastControl;
	request: BroadcastRequest;
	fingerprint: string;
	state: "open" | "archived";
}) {
	const prior = control?.operations[request.operationId];
	if (prior) {
		return prior.fingerprint === fingerprint
			? ({ kind: "replay", receipt: prior.receipt } as const)
			: ({ kind: "already-exists" } as const);
	}
	if (state === "archived") return { kind: "failed-precondition" } as const;
	if ((control?.revision ?? 0) !== request.expectedRevision)
		return { kind: "aborted" } as const;
	const revision = request.expectedRevision + 1;
	const receipt = { revision };
	const next: BroadcastControl = {
		revision,
		operations: {
			...control?.operations,
			[request.operationId]: { fingerprint, receipt },
		},
	};
	if (request.command.kind === "publish") {
		next.document = { ...request.command.document, revision };
	}
	return { kind: "accepted", control: next, receipt } as const;
}

export function changeCodeSubmission({
	control,
	member,
	previous,
	request,
	fingerprint,
	now,
	email,
	state,
}: {
	control?: BroadcastControl;
	member: boolean;
	previous?: CodeSubmission;
	request: CodeRequest;
	fingerprint: string;
	now: number;
	email: string;
	state: "open" | "archived";
}) {
	if (!member) return { kind: "permission-denied" } as const;
	const prior = previous?.operations[request.operationId];
	if (prior) {
		return prior.fingerprint === fingerprint
			? ({ kind: "replay", receipt: prior.receipt } as const)
			: ({ kind: "already-exists" } as const);
	}
	if (
		state !== "open" ||
		control?.document?.kind !== "code" ||
		control.document.revision !== request.broadcastRevision
	)
		return { kind: "failed-precondition" } as const;
	if ((previous?.accepted.revision ?? 0) !== request.expectedRevision)
		return { kind: "aborted" } as const;
	const receipt = {
		revision: request.expectedRevision + 1,
		broadcastRevision: request.broadcastRevision,
		firstSubmittedAt: previous?.accepted.firstSubmittedAt ?? now,
		updatedAt: Math.max(previous?.accepted.updatedAt ?? now, now),
	};
	const submission: CodeSubmission = {
		email,
		accepted: { ...receipt, content: request.content },
		operations: {
			...previous?.operations,
			[request.operationId]: { fingerprint, receipt },
		},
	};
	return { kind: "accepted", submission, receipt } as const;
}
