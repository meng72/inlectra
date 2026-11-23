import { useEffect, useState, type FormEvent } from "react";
import { operationId, type SessionId } from "../functions/src/contract";
import type {
	PublicStudentQuestion,
	StudentQuestionRecord,
	StudentQuestionRequest,
} from "../functions/src/student-questions";
import { mutateStudentQuestion, watchOwnStudentQuestions } from "./firebase";

const questionPageSize = 5;

function questionStatus(question: StudentQuestionRecord) {
	if (question.reviewState === "answered") return "Answered";
	if (question.reviewState === "dismissed") return "Reviewed";
	return question.visibility === "published"
		? "Shared with class"
		: "Waiting for instructor";
}

export default function StudentQuestionDesk({
	id,
	uid,
	published,
}: {
	id: SessionId;
	uid: string;
	published: PublicStudentQuestion[];
}) {
	const [questions, setQuestions] = useState<StudentQuestionRecord[] | null>();
	const [text, setText] = useState("");
	const [editing, setEditing] = useState<StudentQuestionRecord>();
	const [pending, setPending] = useState<StudentQuestionRequest>();
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState("");
	const [visibleOwnCount, setVisibleOwnCount] = useState(questionPageSize);
	const [visibleSharedCount, setVisibleSharedCount] =
		useState(questionPageSize);
	useEffect(() => watchOwnStudentQuestions(id, uid, setQuestions), [id, uid]);

	async function send(request: StudentQuestionRequest) {
		setBusy(true);
		setMessage("");
		setPending(request);
		try {
			await mutateStudentQuestion(request);
			setPending(undefined);
			setEditing(undefined);
			setText("");
			setMessage(
				request.kind === "create"
					? "Your question was sent privately to the instructor."
					: request.kind === "revise"
						? "Your question was updated."
						: "Your question was withdrawn.",
			);
		} catch (error) {
			const code =
				error && typeof error === "object" && "code" in error ? error.code : "";
			if (
				code === "functions/aborted" ||
				code === "functions/failed-precondition" ||
				code === "functions/not-found"
			) {
				setPending(undefined);
				setEditing(undefined);
				setText("");
				setMessage(
					"This question changed before your request was saved. Review its latest status.",
				);
			} else if (code === "functions/resource-exhausted") {
				setPending(undefined);
				setMessage("You have reached the question limit for this lecture.");
			} else {
				setMessage("Could not confirm the change. Retry the same request.");
			}
		} finally {
			setBusy(false);
		}
	}

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy || !text.trim()) return;
		const retry = editing
			? pending?.kind === "revise" && pending.questionId === editing.id
				? pending
				: undefined
			: pending?.kind === "create"
				? pending
				: undefined;
		const request =
			retry ??
			((editing
				? {
						kind: "revise",
						id,
						operationId: operationId.parse(crypto.randomUUID()),
						questionId: editing.id,
						expectedRevision: editing.revision,
						text,
					}
				: {
						kind: "create",
						id,
						operationId: operationId.parse(crypto.randomUUID()),
						text,
					}) satisfies StudentQuestionRequest);
		await send(request);
	}

	function beginEdit(question: StudentQuestionRecord) {
		setPending(undefined);
		setEditing(question);
		setText(question.text);
		setMessage("");
	}

	async function withdraw(question: StudentQuestionRecord) {
		const request =
			(pending?.kind === "withdraw" && pending.questionId === question.id
				? pending
				: undefined) ??
			({
				kind: "withdraw",
				id,
				operationId: operationId.parse(crypto.randomUUID()),
				questionId: question.id,
				expectedRevision: question.revision,
			} satisfies StudentQuestionRequest);
		await send(request);
	}

	const visibleQuestions =
		questions?.filter(({ reviewState }) => reviewState !== "withdrawn") ?? [];
	const remainingOwn = Math.max(0, visibleQuestions.length - visibleOwnCount);
	const remainingShared = Math.max(0, published.length - visibleSharedCount);
	return (
		<section className="student-question-desk panel">
			<div className="section-heading">
				<div>
					<p className="eyebrow">Class Q&amp;A</p>
					<h3>Ask a question</h3>
				</div>
			</div>
			<p className="helper-text">
				Your question is private unless the instructor shares an anonymous copy
				with the class. It does not affect participation credit.
			</p>
			<div className="student-question-columns">
				<div className="student-question-compose">
					<form className="student-question-form" onSubmit={submit}>
						<label htmlFor={`student-question-${id}`}>
							{editing ? "Edit your question" : "Your question"}
						</label>
						<textarea
							id={`student-question-${id}`}
							maxLength={500}
							required
							value={text}
							onChange={(event) => {
								setText(event.target.value);
								if (pending) setPending(undefined);
							}}
						/>
						<div className="form-actions">
							<button type="submit" disabled={busy}>
								{busy ? "Saving…" : editing ? "Save revision" : "Send question"}
							</button>
							{editing && (
								<button
									className="secondary-button"
									type="button"
									disabled={busy}
									onClick={() => {
										setEditing(undefined);
										setPending(undefined);
										setText("");
									}}
								>
									Cancel
								</button>
							)}
						</div>
					</form>
					{message && <p role="status">{message}</p>}
					{questions === undefined && (
						<p role="status">Opening your questions…</p>
					)}
					{questions === null && (
						<p role="alert">Your submitted questions are unavailable.</p>
					)}
					{visibleQuestions.length > 0 && (
						<div className="student-question-list">
							<h4>Your submissions ({visibleQuestions.length})</h4>
							{visibleQuestions.slice(0, visibleOwnCount).map((question) => (
								<article className="student-question-card" key={question.id}>
									<div className="student-question-card-heading">
										<span className="status-pill">
											{questionStatus(question)}
										</span>
									</div>
									<p>{question.text}</p>
									{question.reviewState === "open" &&
										question.visibility === "private" && (
											<div className="form-actions">
												<button
													className="secondary-button"
													type="button"
													disabled={busy}
													onClick={() => beginEdit(question)}
												>
													Edit
												</button>
												<button
													className="text-button"
													type="button"
													disabled={busy}
													onClick={() => withdraw(question)}
												>
													Withdraw
												</button>
											</div>
										)}
								</article>
							))}
							{remainingOwn > 0 ? (
								<button
									className="secondary-button"
									type="button"
									onClick={() =>
										setVisibleOwnCount((count) => count + questionPageSize)
									}
								>
									Show {Math.min(questionPageSize, remainingOwn)} more{" "}
									{remainingOwn === 1 ? "submission" : "submissions"}
								</button>
							) : visibleQuestions.length > questionPageSize ? (
								<button
									className="text-button"
									type="button"
									onClick={() => setVisibleOwnCount(questionPageSize)}
								>
									Show fewer submissions
								</button>
							) : null}
						</div>
					)}
				</div>
				<div className="published-question-list">
					<div className="student-question-feed-heading">
						<h4>Anonymous class questions</h4>
						<span className="count-badge">{published.length}</span>
					</div>
					{published.length === 0 && (
						<p className="notice">
							No anonymous questions have been shared with the class yet.
						</p>
					)}
					{published.slice(0, visibleSharedCount).map((question) => (
						<article className="student-question-card" key={question.id}>
							<span className="status-pill">
								{question.answered ? "Answered" : "Open"}
							</span>
							<p>{question.text}</p>
						</article>
					))}
					{remainingShared > 0 ? (
						<button
							className="secondary-button"
							type="button"
							onClick={() =>
								setVisibleSharedCount((count) => count + questionPageSize)
							}
						>
							Show {Math.min(questionPageSize, remainingShared)} more class{" "}
							{remainingShared === 1 ? "question" : "questions"}
						</button>
					) : published.length > questionPageSize ? (
						<button
							className="text-button"
							type="button"
							onClick={() => setVisibleSharedCount(questionPageSize)}
						>
							Show fewer class questions
						</button>
					) : null}
				</div>
			</div>
		</section>
	);
}
