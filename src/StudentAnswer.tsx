import {
	type FormEvent,
	type SetStateAction,
	useEffect,
	useId,
	useState,
} from "react";
import {
	type AcceptedResponse,
	answer,
	shortAnswerLimit,
	type SubmissionRequest,
} from "../functions/src/answers";
import { operationId, type SessionId } from "../functions/src/contract";
import { optionLetters, type PublicQuestion } from "../functions/src/questions";
import { readOwnAnswer, submitAnswer } from "./firebase";

export function StudentAnswer({
	id,
	uid,
	question,
	draft,
	setDraft,
}: {
	id: SessionId;
	uid: string;
	question: PublicQuestion;
	draft: string | undefined;
	setDraft: (draft: SetStateAction<string | undefined>) => void;
}) {
	const field = useId();
	const [accepted, setAccepted] = useState<AcceptedResponse | null>();
	const [readFailed, setReadFailed] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [saved, setSaved] = useState(false);
	const [retry, setRetry] = useState<SubmissionRequest>();
	useEffect(() => {
		let active = true;
		void readOwnAnswer(id, question.id, uid).then(
			(value) => {
				if (active) setAccepted(value);
			},
			() => {
				if (active) setReadFailed(true);
			},
		);
		return () => {
			active = false;
		};
	}, [id, question.id, uid]);

	const previous = accepted?.answer;
	const value =
		draft ??
		(previous?.type === "multiple-choice"
			? previous.option
			: previous?.type === "multiple-response"
				? previous.options.join("")
				: previous?.type === "numeric"
					? previous.value
					: (previous?.text ?? ""));
	const parsed = answer.safeParse(
		question.type === "multiple-choice"
			? { type: question.type, option: value }
			: question.type === "multiple-response"
				? {
						type: question.type,
						options: optionLetters.filter((option) => value.includes(option)),
					}
				: question.type === "numeric"
					? { type: question.type, value }
					: { type: question.type, text: value },
	);
	const revision = accepted?.revision ?? 0;

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy || accepted === undefined || !parsed.success) return;
		const command = retry ?? {
			id,
			questionId: question.id,
			expectedRevision: revision,
			answer: parsed.data,
			operationId: operationId.parse(crypto.randomUUID()),
		};
		setBusy(true);
		setError("");
		setSaved(false);
		try {
			const receipt = await submitAnswer(command);
			setAccepted({ ...receipt, answer: command.answer });
			setDraft((current) => (current === draft ? undefined : current));
			setRetry(undefined);
			setSaved(true);
		} catch (cause) {
			const code =
				cause && typeof cause === "object" && "code" in cause ? cause.code : "";
			if (code === "functions/aborted") {
				setRetry(undefined);
				setError(
					"Your answer changed in another window. Review the latest saved answer before trying again.",
				);
				try {
					setAccepted(await readOwnAnswer(id, question.id, uid));
				} catch {
					setReadFailed(true);
				}
			} else if (
				code === "functions/failed-precondition" ||
				code === "functions/permission-denied" ||
				code === "functions/not-found" ||
				code === "functions/invalid-argument"
			) {
				setRetry(undefined);
				setError(
					"This answer could not be accepted. Check the selected question.",
				);
			} else {
				setRetry(command);
				setError(
					"Could not confirm that your answer was saved. Retry to send the same answer.",
				);
			}
		} finally {
			setBusy(false);
		}
	}
	if (readFailed)
		return (
			<p role="alert">
				Could not load your accepted answer. Reopen the question to try again.
			</p>
		);

	function edit(value: string) {
		setDraft(value);
		setRetry(undefined);
		setSaved(false);
		setError("");
	}
	return (
		<form className="answer-form" onSubmit={submit}>
			{question.type === "multiple-choice" ||
			question.type === "multiple-response" ? (
				<fieldset
					className="answer-fieldset"
					disabled={busy || accepted === undefined}
				>
					<legend>
						{question.type === "multiple-response"
							? "Your answers. Select all that apply."
							: "Your answer"}
					</legend>
					{question.options.map((option, index) => {
						const letter = optionLetters[index];
						return (
							<label key={letter} className="answer-option answer-option-card">
								<input
									type={
										question.type === "multiple-choice" ? "radio" : "checkbox"
									}
									name={field}
									value={letter}
									checked={
										question.type === "multiple-choice"
											? value === letter
											: value.includes(letter)
									}
									onChange={() => {
										if (question.type === "multiple-choice") edit(letter);
										else {
											const selected = new Set(value);
											if (selected.has(letter)) selected.delete(letter);
											else selected.add(letter);
											edit(
												optionLetters
													.filter((option) => selected.has(option))
													.join(""),
											);
										}
									}}
								/>
								{letter}. {option}
							</label>
						);
					})}
				</fieldset>
			) : question.type === "numeric" ? (
				<>
					<label htmlFor={field}>Your numeric answer</label>
					<input
						id={field}
						type="text"
						inputMode="decimal"
						value={value}
						onChange={(event) => edit(event.currentTarget.value)}
						disabled={busy || accepted === undefined}
					/>
				</>
			) : (
				<>
					<label htmlFor={field}>Your answer</label>
					<textarea
						id={field}
						value={value}
						onChange={(event) => edit(event.currentTarget.value)}
						maxLength={shortAnswerLimit}
						rows={4}
						disabled={busy || accepted === undefined}
					/>
				</>
			)}
			<button
				className="answer-submit"
				type="submit"
				disabled={busy || accepted === undefined || !parsed.success}
			>
				{busy
					? "Saving…"
					: retry
						? "Retry submission"
						: revision
							? "Revise answer"
							: "Submit answer"}
			</button>
			{accepted === undefined && (
				<p className="notice" role="status">
					Loading your answer…
				</p>
			)}
			{accepted && (
				<p className="success-message" role="status">
					{saved ? "Answer saved. " : ""}
					Participation earned: {accepted.participationPoint}. Correctness does
					not affect participation.
				</p>
			)}
			{previous && draft !== undefined && (
				<p>
					Latest saved answer:{" "}
					{previous.type === "multiple-choice"
						? previous.option
						: previous.type === "multiple-response"
							? previous.options.join(", ")
							: previous.type === "numeric"
								? previous.value
								: previous.text}
				</p>
			)}
			{error && <p role="alert">{error}</p>}
		</form>
	);
}
