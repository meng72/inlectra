import {
	lazy,
	Suspense,
	useEffect,
	useRef,
	useState,
	type FormEvent,
} from "react";
import { QRCodeSVG } from "qrcode.react";
import {
	codeInput,
	type OwnerSession,
	type SessionId,
} from "../functions/src/contract";
import type {
	LiveLecture as LiveLectureData,
	QuestionId,
} from "../functions/src/questions";
import {
	archiveLecture,
	deleteLectureData,
	joinLecture,
	watchLiveLecture,
} from "./firebase";
import { QuestionNavigator } from "./QuestionNavigator";
import { QuestionStats } from "./QuestionStats";
import { StudentAnswer } from "./StudentAnswer";

const InstructorBroadcast = lazy(() => import("./InstructorBroadcast"));
const InstructorQuestionInbox = lazy(() => import("./InstructorQuestionInbox"));
const ParticipationReports = lazy(() => import("./ParticipationReports"));
const StudentBroadcast = lazy(() => import("./StudentBroadcast"));
const StudentQuestionDesk = lazy(() => import("./StudentQuestionDesk"));

export type InstructorWorkspaceView = "live" | "bank" | "reports";
const instructorWorkspaceTabs = [
	["live", "Live control"],
	["bank", "Question bank"],
	["reports", "Reports"],
] as const satisfies readonly (readonly [InstructorWorkspaceView, string])[];
type StudentWorkspaceView = "activities" | "material" | "questions";
const studentWorkspaceTabs = [
	["activities", "Activities"],
	["material", "Whiteboard"],
	["questions", "Class Q&A"],
] as const satisfies readonly (readonly [StudentWorkspaceView, string])[];

function joinLink(id: SessionId) {
	const url = new URL(window.location.href);
	url.search = "";
	url.hash = "";
	url.searchParams.set("join", id);
	return url.toString();
}

function qrPresentationLink(id: SessionId) {
	const url = new URL(window.location.href);
	url.search = "";
	url.hash = "";
	url.searchParams.set("qr", id);
	return url.toString();
}

export function QrPresentation({ id }: { id: SessionId }) {
	return (
		<main className="qr-presentation-page">
			<section className="qr-presentation-card">
				<p className="eyebrow">Scan to join</p>
				<h1>Join InLectra</h1>
				<p className="qr-presentation-instruction">
					Scan this code with your phone, then continue with Google.
				</p>
				<div className="qr-presentation-code">
					<QRCodeSVG
						value={joinLink(id)}
						size={640}
						marginSize={3}
						title="Scan to join this InLectra lecture"
					/>
				</div>
				<p className="qr-code-fallback">
					<span className="field-label">Or enter session code</span>
					<code className="session-code">{id}</code>
				</p>
			</section>
		</main>
	);
}

export function OwnerLecture({
	id,
	session,
	workspace,
	onWorkspaceChange,
	onExitLecture,
}: {
	id: SessionId;
	session: OwnerSession | null | undefined;
	workspace: InstructorWorkspaceView;
	onWorkspaceChange: (view: InstructorWorkspaceView) => void;
	onExitLecture: () => void;
}) {
	const [archiving, setArchiving] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [confirmation, setConfirmation] = useState("");
	const [failure, setFailure] = useState(false);
	const [openQuestions, setOpenQuestions] = useState(0);
	const inbox = useRef<HTMLDialogElement>(null);
	const archiveConfirmation = useRef<HTMLDialogElement>(null);
	if (!session)
		return (
			<p role="status">
				{session === null ? "This session is unavailable." : "Opening session…"}
			</p>
		);
	async function archive() {
		setArchiving(true);
		setFailure(false);
		try {
			await archiveLecture(id);
			archiveConfirmation.current?.close();
		} catch {
			setFailure(true);
		} finally {
			setArchiving(false);
		}
	}
	async function remove() {
		if (confirmation !== id) return;
		setDeleting(true);
		setFailure(false);
		try {
			await deleteLectureData(id);
		} catch {
			setFailure(true);
		} finally {
			setDeleting(false);
		}
	}
	return (
		<section className="lecture-workspace receipt">
			<div className="session-sticky-shell">
				<div className="session-command-bar">
					<div className="session-command-title">
						<span className={`status-pill status-${session.state}`}>
							{session.state === "open" ? "Live" : "Archived"}
						</span>
						<div>
							<p className="course-context">
								{session.courseNumber} · {session.semester}
							</p>
							<h2>{session.title}</h2>
							<span className="session-command-code">
								Session <code>{id}</code>
							</span>
						</div>
					</div>
					{session.state === "open" ? (
						<div className="session-command-actions">
							<button
								type="button"
								className="secondary-button"
								onClick={onExitLecture}
							>
								Course home
							</button>
							<a
								className="button-link secondary-button"
								href={qrPresentationLink(id)}
								target="_blank"
								rel="noopener"
								aria-label="Open QR code in presentation tab"
							>
								Show QR
							</a>
							<a className="button-link secondary-button" href={joinLink(id)}>
								Join link
							</a>
							<button
								type="button"
								className="secondary-button"
								aria-label={`Student questions, ${openQuestions} open`}
								onClick={() => inbox.current?.showModal()}
							>
								Student questions
								<span className="count-badge">{openQuestions}</span>
							</button>
							<button
								type="button"
								className="danger-link"
								onClick={() => archiveConfirmation.current?.showModal()}
							>
								End class
							</button>
						</div>
					) : (
						<button type="button" onClick={onExitLecture}>
							Back to archives
						</button>
					)}
				</div>
				{session.state === "open" && (
					<div
						className="instructor-workspace-tabs"
						role="tablist"
						aria-label="Lecture workspace"
					>
						{instructorWorkspaceTabs.map(([view, label], index) => (
							<button
								key={view}
								id={`workspace-tab-${view}`}
								type="button"
								role="tab"
								aria-controls={`workspace-panel-${view}`}
								aria-selected={workspace === view}
								tabIndex={workspace === view ? 0 : -1}
								onClick={() => onWorkspaceChange(view)}
								onKeyDown={(event) => {
									const last = instructorWorkspaceTabs.length - 1;
									const nextIndex =
										event.key === "Home"
											? 0
											: event.key === "End"
												? last
												: event.key === "ArrowLeft"
													? (index + last) % instructorWorkspaceTabs.length
													: event.key === "ArrowRight"
														? (index + 1) % instructorWorkspaceTabs.length
														: undefined;
									if (nextIndex === undefined) return;
									event.preventDefault();
									const [nextView] = instructorWorkspaceTabs[nextIndex];
									onWorkspaceChange(nextView);
									document.getElementById(`workspace-tab-${nextView}`)?.focus();
								}}
							>
								{label}
							</button>
						))}
					</div>
				)}
			</div>
			{session.state === "archived" ? (
				<>
					<p className="notice" role="status">
						Archived. Student access has ended.
					</p>
					<details className="danger-zone">
						<summary>Permanently delete lecture data</summary>
						<p>
							This removes the lecture, memberships, submissions, roster,
							reports, and retry records. It cannot be undone. Type the session
							code to confirm.
						</p>
						<label htmlFor={`delete-${id}`}>Session code</label>
						<input
							id={`delete-${id}`}
							value={confirmation}
							onChange={(event) =>
								setConfirmation(event.target.value.toUpperCase())
							}
						/>
						<button
							className="danger-button"
							type="button"
							disabled={deleting || confirmation !== id}
							onClick={remove}
						>
							{deleting ? "Deleting…" : "Delete lecture data"}
						</button>
					</details>
				</>
			) : workspace === "live" ? (
				<section
					id="workspace-panel-live"
					className="live-control-panel"
					role="tabpanel"
					aria-labelledby="workspace-tab-live"
				>
					<div className="live-control-heading">
						<div>
							<p className="eyebrow">Live control</p>
							<h3>Broadcast to the room</h3>
						</div>
						<p className="helper-text">
							The lecture queue appears below. Use the inbox button above to
							review student questions without leaving this view.
						</p>
					</div>
					<Suspense fallback={<p role="status">Opening broadcast controls…</p>}>
						<InstructorBroadcast id={id} expanded />
					</Suspense>
				</section>
			) : workspace === "reports" ? (
				<section
					id="workspace-panel-reports"
					role="tabpanel"
					aria-labelledby="workspace-tab-reports"
				>
					<Suspense fallback={<p role="status">Opening reports…</p>}>
						<ParticipationReports id={id} standalone />
					</Suspense>
				</section>
			) : null}
			{session.state === "open" && (
				<>
					<dialog
						ref={inbox}
						className="inbox-drawer"
						aria-labelledby={`inbox-title-${id}`}
					>
						<div className="drawer-heading">
							<h2 id={`inbox-title-${id}`}>Student question inbox</h2>
							<button
								type="button"
								className="text-button"
								onClick={() => inbox.current?.close()}
							>
								Close inbox
							</button>
						</div>
						<Suspense
							fallback={<p role="status">Opening student questions…</p>}
						>
							<InstructorQuestionInbox id={id} onOpenCount={setOpenQuestions} />
						</Suspense>
					</dialog>
					<dialog
						ref={archiveConfirmation}
						className="confirmation-dialog"
						aria-labelledby={`archive-title-${id}`}
					>
						<h2 id={`archive-title-${id}`}>End this class?</h2>
						<p>Archiving ends student access immediately.</p>
						<div className="form-actions">
							<button
								className="danger-button"
								type="button"
								disabled={archiving}
								onClick={archive}
							>
								{archiving ? "Ending class…" : "Confirm end class"}
							</button>
							<button
								className="secondary-button"
								type="button"
								disabled={archiving}
								onClick={() => archiveConfirmation.current?.close()}
							>
								Cancel
							</button>
						</div>
						{failure && (
							<p role="alert">Could not confirm archive. Try again.</p>
						)}
					</dialog>
				</>
			)}
			{session.state === "archived" && (
				<Suspense fallback={<p role="status">Opening reports…</p>}>
					<ParticipationReports id={id} standalone />
				</Suspense>
			)}
		</section>
	);
}

function LiveLecture({ id, uid }: { id: SessionId; uid: string }) {
	const [lecture, setLecture] = useState<LiveLectureData | null>();
	const [drafts, setDrafts] = useState<Partial<Record<QuestionId, string>>>({});
	const [workspace, setWorkspace] =
		useState<StudentWorkspaceView>("activities");
	useEffect(() => watchLiveLecture(id, setLecture), [id]);
	if (lecture === null)
		return <p role="status">This lecture is no longer available.</p>;
	return (
		<section className="live-classroom">
			{lecture === undefined ? (
				<p role="status">Opening lecture…</p>
			) : (
				<>
					<div className="student-session-shell">
						<div className="live-classroom-heading">
							<div>
								<p className="course-context">
									{lecture.courseNumber} · {lecture.semester}
								</p>
								<h2>{lecture.title}</h2>
							</div>
							<span className="status-pill status-open" role="status">
								Joined live
							</span>
						</div>
						<div
							className="student-workspace-tabs"
							role="tablist"
							aria-label="Class workspace"
						>
							{studentWorkspaceTabs.map(([view, label], index) => (
								<button
									key={view}
									id={`student-tab-${view}`}
									type="button"
									role="tab"
									aria-controls={`student-panel-${view}`}
									aria-selected={workspace === view}
									aria-label={
										view === "activities" && lecture.questions.length > 0
											? `${label}, ${lecture.questions.length} available`
											: view === "questions" &&
													lecture.studentQuestions.length > 0
												? `${label}, ${lecture.studentQuestions.length} shared`
												: label
									}
									tabIndex={workspace === view ? 0 : -1}
									onClick={() => setWorkspace(view)}
									onKeyDown={(event) => {
										const last = studentWorkspaceTabs.length - 1;
										const nextIndex =
											event.key === "Home"
												? 0
												: event.key === "End"
													? last
													: event.key === "ArrowLeft"
														? (index + last) % studentWorkspaceTabs.length
														: event.key === "ArrowRight"
															? (index + 1) % studentWorkspaceTabs.length
															: undefined;
										if (nextIndex === undefined) return;
										event.preventDefault();
										const [nextView] = studentWorkspaceTabs[nextIndex];
										setWorkspace(nextView);
										document.getElementById(`student-tab-${nextView}`)?.focus();
									}}
								>
									{label}
									{view === "activities" && lecture.questions.length > 0 && (
										<span className="tab-count" aria-hidden="true">
											{lecture.questions.length}
										</span>
									)}
									{view === "questions" &&
										lecture.studentQuestions.length > 0 && (
											<span className="tab-count" aria-hidden="true">
												{lecture.studentQuestions.length}
											</span>
										)}
								</button>
							))}
						</div>
					</div>
					<section
						id="student-panel-activities"
						className="student-workspace-panel"
						role="tabpanel"
						aria-labelledby="student-tab-activities"
						hidden={workspace !== "activities"}
					>
						<QuestionNavigator
							questions={lecture.questions}
							renderQuestion={(question) => {
								const reveal = lecture.reveals?.[question.id];
								return (
									<div key={question.id}>
										<StudentAnswer
											id={id}
											uid={uid}
											question={question}
											draft={drafts[question.id]}
											setDraft={(draft) =>
												setDrafts((current) => ({
													...current,
													[question.id]:
														typeof draft === "function"
															? draft(current[question.id])
															: draft,
												}))
											}
										/>
										{reveal?.statistics && (
											<QuestionStats id={id} question={question} />
										)}
										{reveal?.correctAnswer && (
											<p>Correct answer: {reveal.correctAnswer}</p>
										)}
									</div>
								);
							}}
						/>
					</section>
					<section
						id="student-panel-material"
						className="student-workspace-panel"
						role="tabpanel"
						aria-labelledby="student-tab-material"
						hidden={workspace !== "material"}
					>
						<Suspense fallback={<p role="status">Opening whiteboard…</p>}>
							<StudentBroadcast
								id={id}
								uid={uid}
								document={lecture.broadcast}
							/>
						</Suspense>
					</section>
					<section
						id="student-panel-questions"
						className="student-workspace-panel"
						role="tabpanel"
						aria-labelledby="student-tab-questions"
						hidden={workspace !== "questions"}
					>
						<Suspense fallback={<p role="status">Opening class Q&A…</p>}>
							<StudentQuestionDesk
								id={id}
								uid={uid}
								published={lecture.studentQuestions}
							/>
						</Suspense>
					</section>
				</>
			)}
		</section>
	);
}
export function JoinDesk({ uid }: { uid: string }) {
	const [code, setCode] = useState(
		() =>
			codeInput.safeParse(new URLSearchParams(location.search).get("join"))
				.data ?? "",
	);
	const [joined, setJoined] = useState<SessionId>();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const parsed = codeInput.safeParse(code);
	async function submit(event: FormEvent) {
		event.preventDefault();
		if (!parsed.success || busy) return;
		setBusy(true);
		setJoined(undefined);
		setError("");
		try {
			setJoined((await joinLecture(parsed.data)).id);
		} catch (cause) {
			const code =
				cause && typeof cause === "object" && "code" in cause ? cause.code : "";
			const message =
				code === "functions/not-found"
					? "No lecture has that code."
					: code === "functions/failed-precondition"
						? "The lecture has been archived."
						: code === "functions/deadline-exceeded"
							? "The join window has expired."
							: "Could not join the lecture. Check your connection and try again.";
			setError(message);
		} finally {
			setBusy(false);
		}
	}
	const joinForm = (
		<form className="join-form" onSubmit={submit}>
			<label htmlFor="code">Session code</label>
			<div className="input-action-row">
				<input
					id="code"
					className="code-input"
					placeholder="12-character code"
					autoCapitalize="characters"
					spellCheck={false}
					value={code}
					onChange={(event) => setCode(event.target.value)}
				/>
				<button type="submit" disabled={busy}>
					{busy ? "Joining…" : "Join lecture"}
				</button>
			</div>
			{!parsed.success && code.length > 0 && (
				<p className="field-hint">Enter the complete 12-character code.</p>
			)}
		</form>
	);
	return (
		<section className="join-desk">
			{joined ? (
				<>
					<LiveLecture key={joined} id={joined} uid={uid} />
					<details className="panel compact-details switch-lecture">
						<summary>Join a different lecture</summary>
						{joinForm}
					</details>
				</>
			) : (
				<section className="panel join-card">
					<p className="eyebrow">Enter the classroom</p>
					<h2>Join a lecture</h2>
					<p className="helper-text">
						Scan the instructor’s QR code or enter the session code shown in
						class.
					</p>
					{joinForm}
					{error && <p role="alert">{error}</p>}
				</section>
			)}
			{joined && error && <p role="alert">{error}</p>}
		</section>
	);
}
