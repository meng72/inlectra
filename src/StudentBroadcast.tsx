import { useEffect, useState, type FormEvent } from "react";
import {
	broadcastContent,
	broadcastLimit,
	type BroadcastDocument,
	type CodeRequest,
} from "../functions/src/broadcast";
import { operationId, type SessionId } from "../functions/src/contract";
import { BroadcastPreview } from "./BroadcastPreview";
import { insertCodeTab } from "./codeEditor";
import { readOwnCode, submitCode } from "./firebase";
import { useCodeDraft } from "./useCodeDraft";

export default function StudentBroadcast({
	id,
	uid,
	document,
}: {
	id: SessionId;
	uid: string;
	document?: BroadcastDocument;
}) {
	const { draft, status, save } = useCodeDraft(uid, id);
	const [accepted, setAccepted] =
		useState<Awaited<ReturnType<typeof readOwnCode>>>();
	const [readFailure, setReadFailure] = useState(false);
	const [busy, setBusy] = useState(false);
	const [pending, setPending] = useState<CodeRequest>();
	const [message, setMessage] = useState("");
	const source = document?.kind === "code" ? document : undefined;
	const current = !!source && draft?.broadcastRevision === source.revision;

	useEffect(() => {
		let active = true;
		void readOwnCode(id, uid).then(
			(value) => {
				if (active) setAccepted(value);
			},
			() => {
				if (active) setReadFailure(true);
			},
		);
		return () => {
			active = false;
		};
	}, [id, uid]);

	function copyLatest() {
		if (
			!source ||
			(draft &&
				!window.confirm(
					"Replace your private draft with the latest whiteboard code?",
				))
		)
			return;
		setPending(undefined);
		setMessage("");
		save({
			content: source.content,
			broadcastRevision: source.revision,
			updatedAt: Date.now(),
		});
	}

	async function send(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy || accepted === undefined || readFailure || !draft) return;
		const content = broadcastContent.safeParse(draft.content);
		if (!pending && (!current || !content.success)) return;
		const request = pending ?? {
			id,
			operationId: operationId.parse(crypto.randomUUID()),
			expectedRevision: accepted?.revision ?? 0,
			broadcastRevision: draft.broadcastRevision,
			content: draft.content,
		};
		setBusy(true);
		setMessage("");
		try {
			const receipt = await submitCode(request);
			setAccepted({ ...receipt, content: request.content });
			setPending(undefined);
			setMessage(`Code submission ${receipt.revision} accepted.`);
		} catch (error) {
			const code =
				error && typeof error === "object" && "code" in error ? error.code : "";
			if (code === "functions/aborted") {
				setPending(undefined);
				setMessage(
					"A newer code submission already exists. Review your draft before trying again.",
				);
				try {
					setAccepted(await readOwnCode(id, uid));
				} catch {
					setReadFailure(true);
				}
			} else if (
				code === "functions/failed-precondition" ||
				code === "functions/permission-denied" ||
				code === "functions/invalid-argument" ||
				code === "functions/not-found"
			) {
				setPending(undefined);
				setMessage(
					"The class or whiteboard code changed. Check the latest version before submitting.",
				);
			} else {
				setPending(request);
				setMessage(
					"Could not confirm the upload. Retry to send the same request.",
				);
			}
		} finally {
			setBusy(false);
		}
	}

	return (
		<section className="broadcast-section student-shared-material">
			<div className="section-heading">
				<div>
					<p className="eyebrow">From your instructor</p>
					<h3>Whiteboard</h3>
				</div>
			</div>
			{!document && !draft && status !== "error" && !accepted && (
				<p className="notice">The whiteboard is empty right now.</p>
			)}
			{document && <BroadcastPreview document={document} />}
			{status === "error" && (
				<p role="alert">
					Browser storage is unavailable. Check storage before relying on this
					draft.
				</p>
			)}
			{source && draft === null && (
				<button type="button" onClick={copyLatest}>
					Start private copy
				</button>
			)}
			{draft && (
				<form onSubmit={send}>
					<label>
						Private code draft
						<textarea
							value={draft.content}
							disabled={busy}
							maxLength={broadcastLimit}
							rows={8}
							spellCheck={false}
							onChange={(event) => {
								setPending(undefined);
								setMessage("");
								save({
									...draft,
									content: event.currentTarget.value,
									updatedAt: Date.now(),
								});
							}}
							onKeyDown={(event) => {
								if (event.key !== "Tab") return;
								event.preventDefault();
								const textarea = event.currentTarget;
								const edit = insertCodeTab(
									textarea.value,
									textarea.selectionStart,
									textarea.selectionEnd,
									broadcastLimit,
								);
								if (!edit) return;
								setPending(undefined);
								setMessage("");
								save({
									...draft,
									content: edit.content,
									updatedAt: Date.now(),
								});
								requestAnimationFrame(() =>
									textarea.setSelectionRange(edit.cursor, edit.cursor),
								);
							}}
						/>
					</label>
					{status === "saving" && <p role="status">Saving on this device…</p>}
					{status === "saved" && <p>Saved on this device.</p>}
					{!current && (
						<p>
							{source
								? "This draft is based on an older version. Reset to the latest whiteboard code to submit."
								: "There is no code on the whiteboard right now. Your draft is still available on this device."}
						</p>
					)}
					<div className="question-actions">
						{source && (
							<button type="button" disabled={busy} onClick={copyLatest}>
								Reset to latest whiteboard code
							</button>
						)}
						<button
							type="button"
							disabled={busy || status === "saving"}
							onClick={() => {
								if (window.confirm("Discard this private draft?")) {
									setPending(undefined);
									setMessage("");
									save(null);
								}
							}}
						>
							Discard private draft
						</button>
						<button
							type="submit"
							disabled={
								busy ||
								readFailure ||
								accepted === undefined ||
								(!pending &&
									(!current ||
										!broadcastContent.safeParse(draft.content).success))
							}
						>
							{pending ? "Retry code submission" : "Submit private code"}
						</button>
					</div>
					<p>Submitting uploads this draft to InLectra.</p>
				</form>
			)}
			{accepted && (
				<p>Latest accepted code submission: revision {accepted.revision}.</p>
			)}
			{readFailure && (
				<p role="alert">
					Could not load your saved submission. Rejoin the lecture to try again.
				</p>
			)}
			{message && <p role="status">{message}</p>}
		</section>
	);
}
