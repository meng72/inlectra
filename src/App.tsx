import {
	createContext,
	lazy,
	Suspense,
	type FormEvent,
	type ReactNode,
	useContext,
	useEffect,
	useState,
} from "react";
import {
	codeInput,
	courseId,
	operationId,
	type Course,
	type CourseId,
	type CourseLectureSummary,
	type OwnerSession,
	type SessionId,
} from "../functions/src/contract";
import {
	JoinDesk,
	OwnerLecture,
	QrPresentation,
	type InstructorWorkspaceView,
} from "./Lecture";
import {
	createLecture,
	createCourseWorkspace,
	type Identity,
	leave,
	observeIdentity,
	signIn,
	watchCourseLectures,
	watchCourses,
	watchOwner,
} from "./firebase";
const QuestionWorkspace = lazy(() => import("./QuestionWorkspace"));
type CourseWorkspaceView = "lectures" | "bank" | "archives";
const courseWorkspaceTabs = [
	["lectures", "Lectures"],
	["bank", "Question bank"],
	["archives", "Archives"],
] as const satisfies readonly (readonly [CourseWorkspaceView, string])[];

function lectureDate(createdAt: number) {
	return new Intl.DateTimeFormat(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(createdAt);
}

const AuthContext = createContext<Identity>({ kind: "loading" });

export function AuthProvider({ children }: { children: ReactNode }) {
	const [identity, setIdentity] = useState<Identity>({ kind: "loading" });
	useEffect(() => observeIdentity(setIdentity), []);
	return (
		<AuthContext.Provider value={identity}>{children}</AuthContext.Provider>
	);
}

function InstructorDesk({ uid }: { uid: string }) {
	const prefix = `inlectra:${uid}:`;
	const [courses, setCourses] = useState<Course[]>([]);
	const [selectedCourseId, setSelectedCourseId] = useState<CourseId | undefined>(
		() => courseId.safeParse(sessionStorage.getItem(`${prefix}course`)).data,
	);
	const [courseNumber, setCourseNumber] = useState("");
	const [semester, setSemester] = useState("");
	const [courseBusy, setCourseBusy] = useState(false);
	const [courseError, setCourseError] = useState("");
	const [courseView, setCourseView] =
		useState<CourseWorkspaceView>("lectures");
	const [courseLectures, setCourseLectures] = useState<
		CourseLectureSummary[]
	>([]);
	const [title, setTitle] = useState(
		() => sessionStorage.getItem(`${prefix}title`) ?? "",
	);
	const [busy, setBusy] = useState(false);
	const [last, setLast] = useState<SessionId | undefined>(
		() => codeInput.safeParse(sessionStorage.getItem(`${prefix}last`)).data,
	);
	const [manageCode, setManageCode] = useState("");
	const [error, setError] = useState("");
	const [workspace, setWorkspace] = useState<InstructorWorkspaceView>("live");
	const [managed, setManaged] = useState<{
		id: SessionId;
		session: OwnerSession | null;
	}>();
	const session = managed && managed.id === last ? managed.session : undefined;
	const selectedCourse = courses.find(({ id }) => id === selectedCourseId);
	const courseHome = !last || session === null;
	const openLectures = courseLectures.filter(({ state }) => state === "open");
	const archivedLectures = courseLectures.filter(
		({ state }) => state === "archived",
	);
	useEffect(() => watchCourses(uid, setCourses), [uid]);
	useEffect(() => {
		if (!selectedCourseId) {
			setCourseLectures([]);
			return;
		}
		return watchCourseLectures(uid, selectedCourseId, setCourseLectures);
	}, [selectedCourseId, uid]);
	useEffect(() => {
		if (last)
			return watchOwner(last, (session) => setManaged({ id: last, session }));
	}, [last]);
	useEffect(() => {
		if (!session) return;
		setSelectedCourseId(session.courseId);
		sessionStorage.setItem(`${prefix}course`, session.courseId);
	}, [prefix, session]);

	async function addCourse(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (courseBusy || !courseNumber.trim() || !semester.trim()) return;
		setCourseBusy(true);
		setCourseError("");
		try {
			const created = await createCourseWorkspace({
				courseNumber: courseNumber.trim(),
				semester: semester.trim(),
				operationId: operationId.parse(crypto.randomUUID()),
			});
			setSelectedCourseId(created.id);
			setCourseView("lectures");
			sessionStorage.setItem(`${prefix}course`, created.id);
			setCourseNumber("");
			setSemester("");
		} catch {
			setCourseError("Could not create the course workspace. Try again.");
		} finally {
			setCourseBusy(false);
		}
	}

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy || !title.trim() || !selectedCourseId) return;
		setBusy(true);
		setError("");
		try {
			const normalized = title.trim();
			const previous =
				sessionStorage.getItem(`${prefix}title`) === normalized &&
				sessionStorage.getItem(`${prefix}operation-course`) ===
					selectedCourseId &&
				operationId.safeParse(sessionStorage.getItem(`${prefix}operation`))
					.data;
			const operation = previous || crypto.randomUUID();
			sessionStorage.setItem(`${prefix}title`, normalized);
			sessionStorage.setItem(`${prefix}operation`, operation);
			sessionStorage.setItem(`${prefix}operation-course`, selectedCourseId);
			const session = await createLecture(
				normalized,
				operation,
				selectedCourseId,
			);
			sessionStorage.setItem(`${prefix}last`, session.id);
			setLast(session.id);
			setWorkspace("live");
			sessionStorage.removeItem(`${prefix}title`);
			sessionStorage.removeItem(`${prefix}operation`);
			sessionStorage.removeItem(`${prefix}operation-course`);
			setTitle("");
		} catch {
			setError(
				"Could not create the session. Check your connection and instructor access, then try again.",
			);
		} finally {
			setBusy(false);
		}
	}
	function openLecture(id: SessionId) {
		setLast(id);
		setManaged(undefined);
		setWorkspace("live");
		sessionStorage.setItem(`${prefix}last`, id);
	}
	function closeLecture(nextView: CourseWorkspaceView) {
		sessionStorage.removeItem(`${prefix}last`);
		setLast(undefined);
		setManaged(undefined);
		setWorkspace("live");
		setCourseView(nextView);
	}
	return (
		<section className="instructor-desk">
			{courseHome && (
				<>
			<section className="panel course-home-header">
				<div className="section-heading">
					<div>
						<p className="eyebrow">Instructor workspace</p>
						<h2>Course workspace</h2>
					</div>
				</div>
				<div className="course-workspace-picker">
					<label htmlFor="course-workspace">Course workspace</label>
					<select
						id="course-workspace"
						value={selectedCourseId ?? ""}
						onChange={(event) => {
							const parsed = courseId.safeParse(event.currentTarget.value);
							setSelectedCourseId(parsed.data);
							setCourseView("lectures");
							if (parsed.success)
								sessionStorage.setItem(`${prefix}course`, parsed.data);
							else sessionStorage.removeItem(`${prefix}course`);
						}}
					>
						<option value="">Select a course and semester</option>
						{courses.map((course) => (
							<option key={course.id} value={course.id}>
								{course.courseNumber} — {course.semester}
							</option>
						))}
					</select>
					<details className="compact-details">
						<summary>Create a course workspace</summary>
						<form className="inline-form" onSubmit={addCourse}>
							<label htmlFor="course-number">Course number</label>
							<input
								id="course-number"
								maxLength={40}
								required
								placeholder="CSE 4333"
								value={courseNumber}
								onChange={(event) => setCourseNumber(event.target.value)}
							/>
							<label htmlFor="semester">Semester</label>
							<input
								id="semester"
								maxLength={40}
								required
								placeholder="Fall 2026"
								value={semester}
								onChange={(event) => setSemester(event.target.value)}
							/>
							<button disabled={courseBusy} type="submit">
								{courseBusy ? "Creating…" : "Create course"}
							</button>
						</form>
					</details>
					{courseError && <p role="alert">{courseError}</p>}
				</div>
			</section>
			{selectedCourse ? (
				<>
					<div
						className="course-workspace-tabs"
						role="tablist"
						aria-label="Course sections"
					>
						{courseWorkspaceTabs.map(([view, label], index) => (
							<button
								key={view}
								id={`course-tab-${view}`}
								type="button"
								role="tab"
								aria-controls={`course-panel-${view}`}
								aria-selected={courseView === view}
								onClick={() => setCourseView(view)}
								onKeyDown={(event) => {
									const last = courseWorkspaceTabs.length - 1;
									const nextIndex =
										event.key === "Home"
											? 0
											: event.key === "End"
												? last
												: event.key === "ArrowLeft"
													? (index + last) % courseWorkspaceTabs.length
													: event.key === "ArrowRight"
														? (index + 1) % courseWorkspaceTabs.length
														: undefined;
									if (nextIndex === undefined) return;
									event.preventDefault();
									const [nextView] = courseWorkspaceTabs[nextIndex];
									setCourseView(nextView);
									document.getElementById(`course-tab-${nextView}`)?.focus();
								}}
							>
								{label}
								{view === "archives" && archivedLectures.length > 0 && (
									<span className="tab-count">{archivedLectures.length}</span>
								)}
							</button>
						))}
					</div>
					{courseView === "lectures" && (
						<section
							id="course-panel-lectures"
							className="panel session-setup"
							role="tabpanel"
							aria-labelledby="course-tab-lectures"
						>
							<div className="section-heading">
								<div>
									<p className="eyebrow">Lectures</p>
									<h2>Start a live lecture</h2>
								</div>
							</div>
							<p className="helper-text">
								Create a focused live workspace for {selectedCourse.courseNumber} ·{" "}
								{selectedCourse.semester}.
							</p>
				<form className="inline-form" onSubmit={submit}>
					<label htmlFor="title">Lecture title</label>
					<div className="input-action-row">
						<input
							id="title"
							maxLength={120}
							required
							value={title}
							onChange={(event) => setTitle(event.target.value)}
						/>
						<button disabled={busy || !selectedCourse} type="submit">
							{busy ? "Creating…" : "Create session"}
						</button>
					</div>
				</form>
				{error && <p role="alert">{error}</p>}
				<details className="compact-details">
					<summary>Open an existing lecture</summary>
					<form
						className="inline-form"
						onSubmit={(event) => {
							event.preventDefault();
							const parsed = codeInput.safeParse(manageCode);
							if (parsed.success) {
								openLecture(parsed.data);
							}
						}}
					>
						<label htmlFor="manage-code">Lecture code</label>
						<div className="input-action-row">
							<input
								id="manage-code"
								className="code-input"
								placeholder="12-character code"
								autoCapitalize="characters"
								spellCheck={false}
								value={manageCode}
								onChange={(event) => setManageCode(event.target.value)}
							/>
							<button
								type="submit"
								disabled={!codeInput.safeParse(manageCode).success}
							>
								Open lecture
							</button>
						</div>
					</form>
				</details>
							<div className="course-lecture-section">
								<h3>Open lectures</h3>
								{openLectures.length === 0 ? (
									<p className="helper-text">No open lectures in this course.</p>
								) : (
									<ul className="course-lecture-list">
										{openLectures.map((lecture) => (
											<li key={lecture.id}>
												<div className="course-lecture-meta">
													<strong>{lecture.title}</strong>
													<span>{lectureDate(lecture.createdAt)}</span>
													<code>{lecture.id}</code>
												</div>
												<button type="button" onClick={() => openLecture(lecture.id)}>
													Open lecture
												</button>
											</li>
										))}
									</ul>
								)}
							</div>
						</section>
					)}
					{courseView === "bank" && (
						<Suspense fallback={<p role="status">Opening question bank…</p>}>
							<QuestionWorkspace
								course={selectedCourse}
								canChangeCourse
								onChangeCourse={() =>
									document.getElementById("course-workspace")?.focus()
								}
								panelScope="course"
								view="bank"
							/>
						</Suspense>
					)}
					{courseView === "archives" && (
						<section
							id="course-panel-archives"
							className="panel"
							role="tabpanel"
							aria-labelledby="course-tab-archives"
						>
							<p className="eyebrow">Read-only history</p>
							<h2>Archived lectures</h2>
							<p className="helper-text">
								Open a completed lecture to review its reports or delete its data.
							</p>
							{archivedLectures.length === 0 ? (
								<p>No archived lectures in this course.</p>
							) : (
								<ul className="course-lecture-list">
									{archivedLectures.map((lecture) => (
										<li key={lecture.id}>
											<div className="course-lecture-meta">
												<strong>{lecture.title}</strong>
												<span>{lectureDate(lecture.createdAt)}</span>
												<code>{lecture.id}</code>
											</div>
											<button type="button" onClick={() => openLecture(lecture.id)}>
												View archive
											</button>
										</li>
									))}
								</ul>
							)}
						</section>
					)}
				</>
			) : (
				<p className="notice">Select or create a course workspace to begin.</p>
			)}
				</>
			)}
			{last && !courseHome && (
				<OwnerLecture
					key={last}
					id={last}
					session={session}
					workspace={workspace}
					onWorkspaceChange={setWorkspace}
					onExitLecture={() =>
						closeLecture(session?.state === "archived" ? "archives" : "lectures")
					}
				/>
			)}
			{selectedCourse && session?.state === "open" && (
			<Suspense fallback={<p role="status">Opening question workspace…</p>}>
				<QuestionWorkspace
					course={selectedCourse}
					canChangeCourse={false}
					onChangeCourse={() => undefined}
					lectureId={session.id}
					view={
						workspace === "bank"
								? "bank"
								: workspace === "live"
									? "queue"
									: "hidden"
					}
				/>
			</Suspense>
			)}
		</section>
	);
}

function InstructorExperience({ uid }: { uid: string }) {
	const [view, setView] = useState<"teach" | "join">(() =>
		new URLSearchParams(location.search).has("join") ? "join" : "teach",
	);
	return (
		<>
			<nav className="mode-switcher" aria-label="Instructor workspace">
				<button
					type="button"
					aria-pressed={view === "teach"}
					onClick={() => setView("teach")}
				>
					Teach a class
				</button>
				<button
					type="button"
					aria-pressed={view === "join"}
					onClick={() => setView("join")}
				>
					Join as a student
				</button>
			</nav>
			{view === "teach" ? <InstructorDesk uid={uid} /> : <JoinDesk uid={uid} />}
		</>
	);
}

export function App() {
	const identity = useContext(AuthContext);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	async function accountAction(action: () => Promise<unknown>) {
		setBusy(true);
		setError("");
		try {
			await action();
		} catch {
			setError(
				"Could not complete that account action. Check your connection and try again.",
			);
		} finally {
			setBusy(false);
		}
	}
	const signedIn =
		identity.kind === "instructor" || identity.kind === "student";
	const qrPresentationId = codeInput.safeParse(
		new URLSearchParams(location.search).get("qr"),
	).data;
	if (qrPresentationId) return <QrPresentation id={qrPresentationId} />;
	return (
		<div className="app-shell">
			<a className="skip-link" href="#main-content">
				Skip to main content
			</a>
			<header className="app-header">
				<span className="mark" aria-hidden="true">
					IL
				</span>
				<span className="brand-name">InLectra</span>
				{signedIn && (
					<div className="account-bar">
						<span title={identity.email}>{identity.email}</span>
						<button
							type="button"
							className="text-button"
							disabled={busy}
							onClick={() => accountAction(leave)}
						>
							Sign out
						</button>
					</div>
				)}
			</header>
			<main id="main-content">
				<article className={signedIn ? "workspace-shell" : "auth-card"}>
					<h1>
						{identity.kind === "instructor"
							? "Instructor workspace"
							: identity.kind === "student"
								? "Student workspace"
								: "Start or join a live class"}
					</h1>
					{identity.kind === "loading" && (
						<p role="status">Checking your account…</p>
					)}
					{identity.kind === "signed-out" && (
						<>
							<p className="auth-intro">
								Sign in with Google to create a lecture as an instructor or
								join one as a student.
							</p>
							<button
								type="button"
								disabled={busy}
								onClick={() => accountAction(signIn)}
							>
								Sign in with Google
							</button>
						</>
					)}
					{identity.kind === "ineligible" && (
						<p>A verified Google account is required.</p>
					)}
					{identity.kind === "unavailable" && (
						<p role="alert">
							Your account could not be checked. Sign out and try again.
						</p>
					)}
					{identity.kind === "instructor" && (
						<InstructorExperience
							key={`owner:${identity.uid}`}
							uid={identity.uid}
						/>
					)}
					{identity.kind === "student" && (
						<JoinDesk key={identity.uid} uid={identity.uid} />
					)}
					{error && <p role="alert">{error}</p>}
				</article>
			</main>
		</div>
	);
}
