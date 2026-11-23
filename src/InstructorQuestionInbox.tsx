import { useEffect, useState } from "react";
import { operationId, type SessionId } from "../functions/src/contract";
import type {
	StudentQuestionRecord,
	StudentQuestionReviewRequest,
} from "../functions/src/student-questions";
import {
	reviewStudentQuestion,
	watchStudentQuestionInbox,
} from "./firebase";

type InboxFilter = "open" | "answered" | "dismissed";

export default function InstructorQuestionInbox({
	id,
	onOpenCount,
}: {
	id: SessionId;
	onOpenCount?: (count: number) => void;
}) {
	const [questions, setQuestions] = useState<StudentQuestionRecord[] | null>();
	const [filter, setFilter] = useState<InboxFilter>("open");
	const [showNames, setShowNames] = useState(false);
	const [busy, setBusy] = useState(false);
	const [pending, setPending] = useState<StudentQuestionReviewRequest>();
	const [message, setMessage] = useState("");
	useEffect(() => watchStudentQuestionInbox(id, setQuestions), [id]);

	async function review(
		question: StudentQuestionRecord,
		action: StudentQuestionReviewRequest["action"],
	) {
		if (busy) return;
		const request =
			(pending?.questionId === question.id && pending.action === action
				? pending
				: undefined) ??
			({
				id,
				operationId: operationId.parse(crypto.randomUUID()),
				studentUid: question.authorUid,
				questionId: question.id,
				expectedRevision: question.revision,
				action,
			} satisfies StudentQuestionReviewRequest);
		setBusy(true);
		setPending(request);
		setMessage("");
		try {
			await reviewStudentQuestion(request);
			setPending(undefined);
			setMessage(
				action === "publish"
					? "Published an anonymous copy to the class."
					: action === "answer"
						? "Marked the question answered."
						: "Dismissed the question.",
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
				setMessage(
					"This question changed in another window. Review the latest version.",
				);
			} else {
				setMessage("Could not confirm the review. Retry the same request.");
			}
		} finally {
			setBusy(false);
		}
	}

	const openCount =
		questions?.filter(({ reviewState }) => reviewState === "open").length ?? 0;
	useEffect(() => onOpenCount?.(openCount), [onOpenCount, openCount]);
	const visible =
		questions?.filter(({ reviewState }) => reviewState === filter) ?? [];
	return (
		<section className="question-inbox panel">
			<div className="section-heading">
				<div>
					<p className="eyebrow">Student voice</p>
					<h3>Student question inbox</h3>
				</div>
				<span className="count-badge">
					{openCount} open
				</span>
			</div>
			<p className="helper-text">
				Submissions are private until you publish an anonymous copy.
			</p>
			<div className="inbox-toolbar">
				<fieldset className="filter-group">
					<legend className="visually-hidden">Question status</legend>
					{(["open", "answered", "dismissed"] as const).map((value) => (
						<button
							className="secondary-button"
							type="button"
							aria-pressed={filter === value}
							onClick={() => setFilter(value)}
							key={value}
						>
							{value[0].toUpperCase() + value.slice(1)}
						</button>
					))}
				</fieldset>
				<label className="checkbox-row">
					<input
						type="checkbox"
						checked={showNames}
						onChange={(event) => setShowNames(event.target.checked)}
					/>
					Show student identities
				</label>
			</div>
			{message && <p role="status">{message}</p>}
			{questions === undefined && <p role="status">Opening the inbox…</p>}
			{questions === null && (
				<p role="alert">Student questions are unavailable.</p>
			)}
			{questions && visible.length === 0 && (
				<p className="notice">No {filter} student questions.</p>
			)}
			<div className="inbox-list">
				{visible.map((question) => (
					<article className="inbox-card" key={question.id}>
						<div className="student-question-card-heading">
							<span className="status-pill">
								{question.visibility === "published"
									? "Shared with class"
									: question.reviewState === "open"
										? "Private"
										: question.reviewState}
							</span>
							{showNames && (
								<span className="student-identity">
									{question.authorDisplayName ?? question.authorEmail}
								</span>
							)}
						</div>
						<p>{question.text}</p>
						{question.reviewState === "open" && (
							<div className="inbox-actions">
								{question.visibility === "private" && (
									<button
										type="button"
										disabled={busy}
										onClick={() => review(question, "publish")}
									>
										Publish anonymously
									</button>
								)}
								<button
									className="secondary-button"
									type="button"
									disabled={busy}
									onClick={() => review(question, "answer")}
								>
									Mark answered
								</button>
								<button
									className="text-button"
									type="button"
									disabled={busy}
									onClick={() => review(question, "dismiss")}
								>
									Dismiss
								</button>
							</div>
						)}
					</article>
				))}
			</div>
		</section>
	);
}
