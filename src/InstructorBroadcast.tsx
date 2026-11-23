import { useEffect, useState } from "react";
import {
	broadcastBody,
	broadcastLanguage,
	broadcastLimit,
	languageNames,
	splitBroadcastLines,
	type BroadcastBody,
	type BroadcastRequest,
	type BroadcastDocument,
} from "../functions/src/broadcast";
import { operationId, type SessionId } from "../functions/src/contract";
import { BroadcastPreview } from "./BroadcastPreview";
import { insertCodeTab } from "./codeEditor";
import { mutateBroadcast, watchBroadcastControl } from "./firebase";

const blank: BroadcastBody = {
	kind: "text",
	content: "",
	highlightedLines: [],
};

export default function InstructorBroadcast({
	id,
	expanded = false,
}: {
	id: SessionId;
	expanded?: boolean;
}) {
	const [control, setControl] = useState<{
		revision: number;
		document?: BroadcastDocument;
	} | null>();
	const [edit, setEdit] = useState<{
		document: BroadcastBody;
		base: number;
	}>();
	const [waitingFor, setWaitingFor] = useState(0);
	const [busy, setBusy] = useState(false);
	const [retry, setRetry] = useState<BroadcastRequest>();
	const [message, setMessage] = useState("");
	useEffect(() => watchBroadcastControl(id, setControl), [id]);

	if (!control)
		return (
			<p role="status">
				{control === null ? "Broadcast is unavailable." : "Loading broadcast…"}
			</p>
		);
	const { document: published, revision } = control;
	const current = edit?.document ?? published ?? blank;
	const changes = {
		content: current.content,
		highlightedLines: current.highlightedLines,
	};
	const disabled = busy || revision < waitingFor;
	const stale = !!edit && edit.base !== revision;
	function update(document: BroadcastBody) {
		setEdit({ document, base: edit?.base ?? revision });
		setRetry(undefined);
		setMessage("");
	}
	function changeContent(content: string) {
		const lineCount = splitBroadcastLines(content).length;
		update({
			...current,
			content,
			highlightedLines: current.highlightedLines.filter(
				(line) => line <= lineCount,
			),
		});
	}
	function toggle(line: number) {
		const selected = current.highlightedLines.includes(line);
		update({
			...current,
			highlightedLines: selected
				? current.highlightedLines.filter((entry) => entry !== line)
				: [...current.highlightedLines, line],
		});
	}
	async function send(
		command: BroadcastRequest["command"],
		pending?: BroadcastRequest,
	) {
		if (disabled || (!pending && stale && command.kind === "publish")) return;
		const input = pending ?? {
			id,
			command,
			expectedRevision:
				command.kind === "publish" ? (edit?.base ?? revision) : revision,
			operationId: operationId.parse(crypto.randomUUID()),
		};
		setBusy(true);
		setMessage("");
		try {
			const receipt = await mutateBroadcast(input);
			setWaitingFor(receipt.revision);
			setEdit(undefined);
			setRetry(undefined);
			setMessage(
				input.command.kind === "clear"
					? "Broadcast cleared."
					: "Broadcast sent.",
			);
		} catch (error) {
			const code =
				error && typeof error === "object" && "code" in error ? error.code : "";
			if (code === "functions/aborted") {
				setRetry(undefined);
				setMessage(
					"The broadcast changed in another window. Review your edit before sending again.",
				);
			} else if (
				code === "functions/failed-precondition" ||
				code === "functions/permission-denied" ||
				code === "functions/invalid-argument"
			) {
				setRetry(undefined);
				setMessage(
					"The broadcast could not be sent. Check the lecture and content.",
				);
			} else {
				setRetry(input);
				setMessage("Could not confirm the change. Retry the same request.");
			}
		} finally {
			setBusy(false);
		}
	}
	const parsed = broadcastBody.safeParse(
		current.kind === "code"
			? { ...changes, kind: current.kind, language: current.language }
			: { ...changes, kind: current.kind },
	);
	return (
		<details className="broadcast-section" open={expanded}>
			<summary>Lecture broadcast</summary>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					if (parsed.success)
						void send({ kind: "publish", document: parsed.data });
				}}
			>
				<label>
					Format
					<select
						value={current.kind}
						disabled={disabled}
						onChange={(event) =>
							update(
								event.currentTarget.value === "code"
									? { kind: "code", ...changes, language: "plain" }
									: { kind: "text", ...changes },
							)
						}
					>
						<option value="text">Text</option>
						<option value="code">Code</option>
					</select>
				</label>
				{current.kind === "code" && (
					<label>
						Language
						<select
							value={current.language}
							disabled={disabled}
							onChange={(event) =>
								update({
									...current,
									language: broadcastLanguage.parse(event.currentTarget.value),
								})
							}
						>
							{broadcastLanguage.options.map((lang) => (
								<option key={lang} value={lang}>
									{languageNames[lang]}
								</option>
							))}
						</select>
					</label>
				)}
				<label>
					Broadcast content
					<textarea
						value={current.content}
						onChange={(event) => changeContent(event.currentTarget.value)}
						onKeyDown={(event) => {
							if (current.kind !== "code" || event.key !== "Tab") return;
							event.preventDefault();
							const textarea = event.currentTarget;
							const edit = insertCodeTab(
								textarea.value,
								textarea.selectionStart,
								textarea.selectionEnd,
								broadcastLimit,
							);
							if (!edit) return;
							changeContent(edit.content);
							requestAnimationFrame(() =>
								textarea.setSelectionRange(edit.cursor, edit.cursor),
							);
						}}
						maxLength={broadcastLimit}
						disabled={disabled}
						rows={6}
						spellCheck={false}
					/>
				</label>
				{current.content && (
					<div>
						<p>Preview. Select line numbers to highlight them.</p>
						<BroadcastPreview
							document={current}
							toggle={disabled ? undefined : toggle}
						/>
					</div>
				)}
				<div className="question-actions">
					<button
						type="submit"
						disabled={disabled || !!retry || stale || !parsed.success}
					>
						Send broadcast
					</button>
					<button
						type="button"
						disabled={disabled || !!retry || !published}
						onClick={() => send({ kind: "clear" })}
					>
						Clear broadcast
					</button>
					{retry && (
						<button
							type="button"
							disabled={disabled}
							onClick={() => send(retry.command, retry)}
						>
							Retry broadcast change
						</button>
					)}
				</div>
				{stale && (
					<div>
						<p>The live broadcast changed while you were editing.</p>
						{published && <BroadcastPreview document={published} />}
						<div className="question-actions">
							<button
								type="button"
								disabled={disabled || !!retry}
								onClick={() => setEdit(undefined)}
							>
								Discard my edit
							</button>
							<button
								type="button"
								disabled={disabled || !!retry}
								onClick={() => setEdit({ document: current, base: revision })}
							>
								Keep my edit
							</button>
						</div>
					</div>
				)}
				{message && <p role="status">{message}</p>}
			</form>
		</details>
	);
}
