import {
	type ChangeEvent,
	type FormEvent,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	operationId,
	type Course,
	type CourseId,
	type SessionId,
} from "../functions/src/contract";
import { nextQuestionState } from "../functions/src/question-plan";
import {
	availableQuestions,
	csvHeaders,
	noReveals,
	optionLetters,
	questionContent,
	studentQuestion,
	type PlanOperation,
	type QuestionContent,
	type QuestionId,
	type QuestionPlan,
	validateQuestionRows,
} from "../functions/src/questions";
import {
	type BankQuestion,
	createBankQuestion,
	deleteBankQuestion,
	importBankQuestions,
	mutateQuestionPlan,
	updateBankQuestion,
	watchQuestionBank,
	watchQuestionPlan,
} from "./firebase";
import { QuestionNavigator } from "./QuestionNavigator";
import { QuestionStats } from "./QuestionStats";
import { readCsv } from "./readCsv";

type CsvPreview = {
	rows: string[][];
	questions: { key: string; question: QuestionContent }[];
	operation: string;
};
type CourseContext = Pick<Course, "id" | "courseNumber" | "semester">;

type OptionLetter = (typeof optionLetters)[number];
type ChoiceDraftFields = {
	prompt: string;
	graded: boolean;
	options: string[];
	correctAnswers: OptionLetter[];
};
type ChoiceDraft =
	| ({ type: "multiple-choice" } & ChoiceDraftFields)
	| ({ type: "multiple-response" } & ChoiceDraftFields);
type TextDraftFields = {
	prompt: string;
	graded: boolean;
	correctAnswer: string;
};
type TextDraft =
	| ({ type: "numeric" } & TextDraftFields)
	| ({ type: "short-answer" } & TextDraftFields);
type QuestionDraft = ChoiceDraft | TextDraft;
type QuestionEditorTarget =
	| { kind: "create" }
	| { kind: "edit"; item: BankQuestion };
const editableQuestionTypes = [
	"multiple-choice",
	"multiple-response",
	"numeric",
	"short-answer",
] as const satisfies readonly QuestionContent["type"][];

function questionTypeLabel(type: QuestionContent["type"]) {
	switch (type) {
		case "multiple-choice":
			return "Multiple choice";
		case "multiple-response":
			return "Multiple response";
		case "numeric":
			return "Numeric";
		case "short-answer":
			return "Essay";
	}
}

function questionDraft(question: QuestionContent): QuestionDraft {
	if (
		question.type === "multiple-choice" ||
		question.type === "multiple-response"
	) {
		return {
			type: question.type,
			prompt: question.prompt,
			graded: question.graded,
			options: [...question.options],
			correctAnswers: optionLetters.filter((letter) =>
				question.correctAnswer.includes(letter),
			),
		};
	}
	return {
		type: question.type,
		prompt: question.prompt,
		graded: question.graded,
		correctAnswer: question.correctAnswer,
	};
}

function newQuestionDraft(
	type: QuestionContent["type"],
	common: Pick<QuestionDraft, "prompt" | "graded"> = {
		prompt: "",
		graded: true,
	},
): QuestionDraft {
	if (type === "multiple-choice" || type === "multiple-response") {
		return {
			...common,
			type,
			options: ["", ""],
			correctAnswers: type === "multiple-choice" ? ["A"] : [],
		};
	}
	return { ...common, type, correctAnswer: "" };
}

function questionCandidate(draft: QuestionDraft): unknown {
	if (draft.type === "multiple-choice") {
		return {
			type: draft.type,
			prompt: draft.prompt,
			graded: draft.graded,
			options: draft.options,
			correctAnswer: draft.correctAnswers[0] ?? "",
		};
	}
	if (draft.type === "multiple-response") {
		return {
			type: draft.type,
			prompt: draft.prompt,
			graded: draft.graded,
			options: draft.options,
			correctAnswer: draft.correctAnswers.join(", "),
		};
	}
	return {
		type: draft.type,
		prompt: draft.prompt,
		graded: draft.graded,
		correctAnswer: draft.correctAnswer,
	};
}

function QuestionEditor({
	courseId,
	target,
	onCancel,
	onSaved,
}: {
	courseId: CourseId;
	target: QuestionEditorTarget;
	onCancel: () => void;
	onSaved: () => void;
}) {
	const dialog = useRef<HTMLDialogElement>(null);
	const [draft, setDraft] = useState(() =>
		target.kind === "edit"
			? questionDraft(target.item.question)
			: newQuestionDraft("multiple-choice"),
	);
	const [requestId, setRequestId] = useState(() =>
		operationId.parse(crypto.randomUUID()),
	);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	useEffect(() => {
		dialog.current?.showModal();
		return () => dialog.current?.close();
	}, []);

	function revise(change: (current: QuestionDraft) => QuestionDraft) {
		setDraft(change);
		setRequestId(operationId.parse(crypto.randomUUID()));
		setError("");
	}

	function updateOption(index: number, value: string) {
		revise((current) => {
			if (
				current.type !== "multiple-choice" &&
				current.type !== "multiple-response"
			)
				return current;
			const options = [...current.options];
			options[index] = value;
			return { ...current, options };
		});
	}

	function removeOption(index: number) {
		revise((current) => {
			if (
				current.type !== "multiple-choice" &&
				current.type !== "multiple-response"
			)
				return current;
			const options = current.options.filter(
				(_, position) => position !== index,
			);
			const validAnswers = new Set(optionLetters.slice(0, options.length));
			const correctAnswers = current.correctAnswers.filter((answer) =>
				validAnswers.has(answer),
			);
			return {
				...current,
				options,
				correctAnswers:
					current.type === "multiple-choice" && correctAnswers.length === 0
						? ["A"]
						: correctAnswers,
			};
		});
	}

	async function save(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy) return;
		const question = questionContent.safeParse(questionCandidate(draft));
		if (!question.success) {
			setError(
				question.error.issues[0]?.message ??
					"Correct the question and try again.",
			);
			return;
		}
		setBusy(true);
		setError("");
		try {
			if (target.kind === "create")
				await createBankQuestion({
					courseId,
					operationId: requestId,
					question: question.data,
				});
			else
				await updateBankQuestion({
					courseId,
					id: target.item.id,
					expectedRevision: target.item.revision,
					operationId: requestId,
					question: question.data,
				});
			onSaved();
		} catch (reason) {
			const code =
				reason && typeof reason === "object" && "code" in reason
					? reason.code
					: undefined;
			setError(
				target.kind === "edit" && code === "functions/aborted"
					? "This question changed in another tab. Close this editor, review the latest version, and try again."
					: target.kind === "edit" && code === "functions/not-found"
						? "This question is no longer in the bank."
						: `Could not confirm the ${target.kind === "create" ? "new question" : "update"}. Try again to reuse the same request.`,
			);
		} finally {
			setBusy(false);
		}
	}

	const choiceDraft =
		draft.type === "multiple-choice" || draft.type === "multiple-response"
			? draft
			: undefined;
	return (
		<dialog
			ref={dialog}
			className="question-editor"
			aria-labelledby="question-editor-title"
			onCancel={(event) => {
				event.preventDefault();
				if (!busy) onCancel();
			}}
		>
			<form onSubmit={save}>
				<div className="question-editor-heading">
					<div>
						<p className="eyebrow">Question bank</p>
						<h2 id="question-editor-title">
							{target.kind === "create" ? "Create question" : "Edit question"}
						</h2>
					</div>
					{target.kind === "edit" && (
						<span className="question-type-badge">
							{questionTypeLabel(draft.type)}
						</span>
					)}
				</div>
				<p className="helper-text">
					{target.kind === "create"
						? "Create a reusable question, then add it to this or a future lecture queue."
						: "This changes the reusable bank question. Copies already in lecture queues will not change."}
				</p>
				{target.kind === "create" && (
					<label className="question-editor-form-label">
						Question type
						<select
							value={draft.type}
							onChange={(event) => {
								const type = editableQuestionTypes.find(
									(value) => value === event.currentTarget.value,
								);
								if (type)
									revise((current) =>
										newQuestionDraft(type, {
											prompt: current.prompt,
											graded: current.graded,
										}),
									);
							}}
						>
							{editableQuestionTypes.map((type) => (
								<option key={type} value={type}>
									{questionTypeLabel(type)}
								</option>
							))}
						</select>
					</label>
				)}
				<label className="question-editor-form-label">
					Question
					<textarea
						autoFocus
						required
						maxLength={2000}
						value={draft.prompt}
						onChange={(event) => {
							const prompt = event.currentTarget.value;
							revise((current) => ({
								...current,
								prompt,
							}));
						}}
					/>
				</label>
				<label className="checkbox-row editor-graded">
					<input
						type="checkbox"
						checked={draft.graded}
						onChange={(event) => {
							const graded = event.currentTarget.checked;
							revise((current) => ({
								...current,
								graded,
							}));
						}}
					/>
					Award participation credit when submitted
				</label>
				{choiceDraft && (
					<fieldset className="editor-options">
						<legend>Answer choices</legend>
						{choiceDraft.options.map((option, index) => (
							<div className="editor-option-row" key={optionLetters[index]}>
								<label>
									<span>{optionLetters[index]}</span>
									<input
										required
										maxLength={200}
										value={option}
										onChange={(event) =>
											updateOption(index, event.currentTarget.value)
										}
									/>
								</label>
								{choiceDraft.options.length > 2 && (
									<button
										className="text-button"
										type="button"
										aria-label={`Remove choice ${optionLetters[index]}`}
										onClick={() => removeOption(index)}
									>
										Remove
									</button>
								)}
							</div>
						))}
						{choiceDraft.options.length < optionLetters.length && (
							<button
								className="secondary-button"
								type="button"
								onClick={() =>
									revise((current) =>
										current.type === "multiple-choice" ||
										current.type === "multiple-response"
											? { ...current, options: [...current.options, ""] }
											: current,
									)
								}
							>
								Add choice
							</button>
						)}
					</fieldset>
				)}
				{choiceDraft?.type === "multiple-choice" && (
					<label className="question-editor-form-label">
						Correct answer
						<select
							value={choiceDraft.correctAnswers[0] ?? ""}
							onChange={(event) => {
								const answer = optionLetters.find(
									(letter) => letter === event.currentTarget.value,
								);
								if (answer)
									revise((current) =>
										current.type === "multiple-choice"
											? { ...current, correctAnswers: [answer] }
											: current,
									);
							}}
						>
							{choiceDraft.options.map((option, index) => (
								<option key={optionLetters[index]} value={optionLetters[index]}>
									{optionLetters[index]} — {option || "Blank choice"}
								</option>
							))}
						</select>
					</label>
				)}
				{choiceDraft?.type === "multiple-response" && (
					<fieldset className="editor-correct-answers">
						<legend>Correct answers</legend>
						{choiceDraft.options.map((option, index) => {
							const letter = optionLetters[index];
							return (
								<label className="checkbox-row" key={letter}>
									<input
										type="checkbox"
										checked={choiceDraft.correctAnswers.includes(letter)}
										onChange={(event) => {
											const checked = event.currentTarget.checked;
											revise((current) => {
												if (current.type !== "multiple-response")
													return current;
												return {
													...current,
													correctAnswers: checked
														? [...current.correctAnswers, letter].sort()
														: current.correctAnswers.filter(
																(answer) => answer !== letter,
															),
												};
											});
										}}
									/>
									{letter} — {option || "Blank choice"}
								</label>
							);
						})}
					</fieldset>
				)}
				{draft.type === "numeric" && (
					<label className="question-editor-form-label">
						Correct numeric answer
						<input
							required
							inputMode="decimal"
							value={draft.correctAnswer}
							onChange={(event) => {
								const correctAnswer = event.currentTarget.value;
								revise((current) =>
									current.type === "numeric"
										? { ...current, correctAnswer }
										: current,
								);
							}}
						/>
					</label>
				)}
				{draft.type === "short-answer" && (
					<label className="question-editor-form-label">
						Answer key (optional)
						<textarea
							maxLength={500}
							value={draft.correctAnswer}
							onChange={(event) => {
								const correctAnswer = event.currentTarget.value;
								revise((current) =>
									current.type === "short-answer"
										? { ...current, correctAnswer }
										: current,
								);
							}}
						/>
					</label>
				)}
				{error && <p role="alert">{error}</p>}
				<div className="question-editor-actions">
					<button
						className="secondary-button"
						type="button"
						disabled={busy}
						onClick={onCancel}
					>
						Cancel
					</button>
					<button type="submit" disabled={busy}>
						{busy
							? "Saving…"
							: target.kind === "create"
								? "Create question"
								: "Save changes"}
					</button>
				</div>
			</form>
		</dialog>
	);
}

function QuestionDetails({ question }: { question: QuestionContent }) {
	return (
		<details>
			<summary>
				{questionTypeLabel(question.type)} ·{" "}
				{question.graded ? "Graded" : "Ungraded"}
			</summary>
			{(question.type === "multiple-choice" ||
				question.type === "multiple-response") && (
				<ol type="A">
					{question.options.map((option, index) => (
						<li key={optionLetters[index]}>{option}</li>
					))}
				</ol>
			)}
			<p>Answer key: {question.correctAnswer || "None"}</p>
		</details>
	);
}

async function previewCsv(file: File): Promise<CsvPreview> {
	if (file.size > 1_000_000) throw new Error("Choose a CSV file under 1 MB.");
	const [headers, ...rows] = readCsv(await file.text());
	const matches = (expected: readonly string[]) =>
		headers?.length === expected.length &&
		expected.every((header, index) => headers[index] === header);
	if (!matches(csvHeaders)) {
		throw new Error(
			"The CSV header must match the column names and order shown above.",
		);
	}
	const verified = validateQuestionRows(rows);
	if (!verified.ok) throw new Error(verified.errors.join("\n"));
	return {
		rows,
		questions: verified.questions.map((question) => ({
			key: crypto.randomUUID(),
			question,
		})),
		operation: crypto.randomUUID(),
	};
}

function CsvImport({
	course,
	canChangeCourse,
	onChangeCourse,
}: {
	course: CourseContext;
	canChangeCourse: boolean;
	onChangeCourse: () => void;
}) {
	const [preview, setPreview] = useState<CsvPreview>();
	const [busy, setBusy] = useState(false);
	const [status, setStatus] = useState("");
	const [errors, setErrors] = useState<string[]>([]);
	const fileInput = useRef<HTMLInputElement>(null);

	async function load(event: ChangeEvent<HTMLInputElement>) {
		const file = event.currentTarget.files?.[0];
		setPreview(undefined);
		setStatus("");
		setErrors([]);
		if (!file) return;
		setBusy(true);
		try {
			setPreview(await previewCsv(file));
		} catch (error) {
			setErrors(
				error instanceof Error
					? error.message.split("\n")
					: ["Could not read the CSV file."],
			);
		} finally {
			setBusy(false);
		}
	}

	async function save() {
		if (!preview || busy) return;
		setBusy(true);
		setErrors([]);
		try {
			const ids = await importBankQuestions(
				preview.rows,
				preview.operation,
				course.id,
			);
			setStatus(
				`Imported ${ids.length} ${ids.length === 1 ? "question" : "questions"}.`,
			);
			setPreview(undefined);
			if (fileInput.current) fileInput.current.value = "";
		} catch {
			setErrors([
				"Could not confirm the import. Try again to reuse the same import request.",
			]);
		} finally {
			setBusy(false);
		}
	}

	return (
		<details className="csv-import compact-details">
			<summary>Import questions from CSV</summary>
			<div className="import-destination">
				<div>
					<span className="field-label">Importing into</span>
					<strong>
						{course.courseNumber} · {course.semester}
					</strong>
				</div>
				{canChangeCourse ? (
					<button
						type="button"
						className="text-button"
						onClick={onChangeCourse}
					>
						Change course
					</button>
				) : (
					<span className="field-hint">Fixed for this lecture</span>
				)}
			</div>
			<p className="helper-text">Required column order:</p>
			<p className="csv-header">
				<code>{csvHeaders.join(",")}</code>
			</p>
			<label>
				CSV file
				<input
					ref={fileInput}
					type="file"
					accept=".csv,text/csv"
					disabled={busy}
					onChange={load}
				/>
			</label>
			{errors.length > 0 && (
				<ul role="alert">
					{[...new Set(errors)].map((error) => (
						<li key={error}>{error}</li>
					))}
				</ul>
			)}
			{preview && (
				<>
					<p>
						Preview of {preview.questions.length}{" "}
						{preview.questions.length === 1 ? "question" : "questions"}
					</p>
					<ol className="csv-preview">
						{preview.questions.map(({ key, question }) => (
							<li key={key}>
								<p className="question-prompt">{question.prompt}</p>
								<QuestionDetails question={question} />
							</li>
						))}
					</ol>
					<button type="button" disabled={busy} onClick={save}>
						Import questions
					</button>
				</>
			)}
			{status && <p role="status">{status}</p>}
		</details>
	);
}

const questionActions = ["publish", "hide", "skip", "restore"] as const;

function LectureQueue({
	lectureId,
	plan,
	pending,
	run,
}: {
	lectureId: SessionId;
	plan: QuestionPlan;
	pending: boolean;
	run: (operation: PlanOperation) => void;
}) {
	const available = useMemo(() => availableQuestions(plan), [plan]);
	const canPublishAll = plan.items.some(({ state }) => state !== "available");
	const canHideAll = plan.items.some(({ state }) => state === "available");
	return (
		<>
			<fieldset className="queue-toolbar">
				<legend className="visually-hidden">Queue actions</legend>
				<button
					type="button"
					disabled={pending || !canPublishAll}
					onClick={() => run({ kind: "publish-all" })}
				>
					Publish all
				</button>
				<button
					className="secondary-button"
					type="button"
					disabled={pending || !canHideAll}
					onClick={() => run({ kind: "hide-all" })}
				>
					Hide all
				</button>
				<button
					className="secondary-button"
					type="button"
					disabled={pending || plan.items.length < 2}
					onClick={() => run({ kind: "shuffle" })}
				>
					Shuffle queue
				</button>
			</fieldset>
			{plan.items.length === 0 && (
				<p>Add questions from your bank to build the queue.</p>
			)}
			<ol className="question-list queue-list">
				{plan.items.map(
					({ id, question, state, reveals = noReveals }, index) => (
						<li className="question-list-card" key={id}>
							<div className="question-card-heading">
								<span className="question-number">Question {index + 1}</span>
								<span className={`question-state state-${state}`}>{state}</span>
							</div>
							<p className="question-prompt">{question.prompt}</p>
							<div className="question-actions">
								<button
									className="secondary-button"
									type="button"
									disabled={pending || index === 0}
									aria-label={`Move question ${index + 1} up`}
									onClick={() => run({ kind: "move", id, by: -1 })}
								>
									Move up
								</button>
								<button
									className="secondary-button"
									type="button"
									disabled={pending || index === plan.items.length - 1}
									aria-label={`Move question ${index + 1} down`}
									onClick={() => run({ kind: "move", id, by: 1 })}
								>
									Move down
								</button>
								{questionActions
									.filter((kind) => nextQuestionState(state, kind))
									.map((kind) => (
										<button
											className={
												kind === "publish"
													? "question-action"
													: "question-action secondary-button"
											}
											type="button"
											key={kind}
											disabled={pending}
											onClick={() => run({ kind, id })}
										>
											{kind}
										</button>
									))}
							</div>
							{state === "available" && (
								<div className="question-actions">
									<button
										className="secondary-button"
										type="button"
										disabled={pending}
										onClick={() =>
											run({
												kind: "reveal",
												id,
												target: "statistics",
												visible: !reveals.statistics,
											})
										}
									>
										{reveals.statistics ? "Hide statistics" : "Show statistics"}
									</button>
									{question.correctAnswer && (
										<button
											className="secondary-button"
											type="button"
											disabled={pending}
											onClick={() =>
												run({
													kind: "reveal",
													id,
													target: "correctAnswer",
													visible: !reveals.correctAnswer,
												})
											}
										>
											{reveals.correctAnswer ? "Hide answer" : "Show answer"}
										</button>
									)}
								</div>
							)}
							<details>
								<summary>Response statistics</summary>
								<QuestionStats
									id={lectureId}
									question={studentQuestion(id, question)}
								/>
							</details>
						</li>
					),
				)}
			</ol>
			<details className="student-preview compact-details">
				<summary>Preview the student view</summary>
				<QuestionNavigator questions={available} />
			</details>
		</>
	);
}

type PlanCommand = Parameters<typeof mutateQuestionPlan>[0];
const bankPageSize = 10;
const bankTypeOptions = [
	["all", "All question types"],
	["multiple-choice", "Multiple choice"],
	["multiple-response", "Multiple response"],
	["numeric", "Numeric"],
	["short-answer", "Essay"],
] as const;
type BankTypeFilter = (typeof bankTypeOptions)[number][0];

export default function QuestionWorkspace({
	course,
	lectureId,
	canChangeCourse,
	onChangeCourse,
	panelScope = "lecture",
	view = "bank",
}: {
	course: CourseContext;
	lectureId?: SessionId;
	canChangeCourse: boolean;
	onChangeCourse: () => void;
	panelScope?: "course" | "lecture";
	view?: "bank" | "queue" | "hidden";
}) {
	const courseId: CourseId = course.id;
	const [bank, setBank] = useState<BankQuestion[] | null>();
	const [openedPlan, setOpenedPlan] = useState<{
		id: SessionId;
		plan: QuestionPlan | null;
	}>();
	const [pending, setPending] = useState(false);
	const [retry, setRetry] = useState<PlanCommand>();
	const [completed, setCompleted] = useState<{
		id: SessionId;
		revision: number;
	}>();
	const [queueError, setQueueError] = useState("");
	const [bankError, setBankError] = useState("");
	const [bankStatus, setBankStatus] = useState("");
	const [editor, setEditor] = useState<QuestionEditorTarget>();
	const [bankQuery, setBankQuery] = useState("");
	const [bankType, setBankType] = useState<BankTypeFilter>("all");
	const [visibleBankCount, setVisibleBankCount] = useState(bankPageSize);
	const editorOpener = useRef<HTMLButtonElement>(null);
	const plan =
		openedPlan && openedPlan.id === lectureId ? openedPlan.plan : undefined;
	const awaitingUpdate =
		!!plan &&
		!!completed &&
		completed.id === lectureId &&
		plan.revision < completed.revision;
	const queued = new Set(plan?.items.map(({ id }) => id));
	const filteredBank = useMemo(() => {
		const query = bankQuery.trim().toLocaleLowerCase();
		return (bank ?? []).filter(
			({ question }) =>
				(bankType === "all" || question.type === bankType) &&
				(!query || question.prompt.toLocaleLowerCase().includes(query)),
		);
	}, [bank, bankQuery, bankType]);
	const visibleBank = filteredBank.slice(0, visibleBankCount);

	useEffect(() => {
		setBank(undefined);
		return watchQuestionBank(courseId, setBank);
	}, [courseId]);
	useEffect(() => {
		if (lectureId)
			return watchQuestionPlan(lectureId, (plan) =>
				setOpenedPlan({ id: lectureId, plan }),
			);
	}, [lectureId]);

	async function run(command: PlanCommand) {
		setPending(true);
		setQueueError("");
		setRetry(undefined);
		try {
			const receipt = await mutateQuestionPlan(command);
			setCompleted({ id: command.id, revision: receipt.revision });
		} catch (error) {
			const code =
				error && typeof error === "object" && "code" in error
					? error.code
					: undefined;
			switch (code) {
				case "functions/aborted":
					setQueueError(
						"The queue changed. Review the latest order and try again.",
					);
					break;
				case "functions/failed-precondition":
				case "functions/not-found":
				case "functions/permission-denied":
					setQueueError("That action is no longer available.");
					break;
				default:
					setQueueError(
						"Could not confirm the update. Retry to reuse the same request.",
					);
					setRetry(command);
			}
		} finally {
			setPending(false);
		}
	}
	function choose(operation: PlanOperation) {
		if (!lectureId || !plan || pending || awaitingUpdate) return;
		void run({
			id: lectureId,
			operation,
			expectedRevision: plan.revision,
			operationId: operationId.parse(crypto.randomUUID()),
		});
	}
	async function remove(id: QuestionId) {
		if (
			!window.confirm(
				"Delete this question from your bank? Existing lecture copies will remain.",
			)
		)
			return;
		setBankError("");
		setBankStatus("");
		try {
			await deleteBankQuestion(courseId, id);
		} catch {
			setBankError("Could not delete the question. Try again.");
		}
	}
	function closeEditor(status?: string) {
		setEditor(undefined);
		if (status) setBankStatus(status);
		queueMicrotask(() => editorOpener.current?.focus());
	}
	return (
		<div
			className={`question-workspace question-workspace-${view}`}
			hidden={view === "hidden"}
		>
			{view === "bank" && (
			<section
				id={panelScope === "course" ? "course-panel-bank" : "workspace-panel-bank"}
				className="workspace-panel"
				role="tabpanel"
				aria-labelledby={
					panelScope === "course" ? "course-tab-bank" : "workspace-tab-bank"
				}
			>
				<div className="section-heading">
					<div>
						<p className="eyebrow">Reusable library</p>
						<h2>Question bank</h2>
						<p className="course-context">
							{course.courseNumber} · {course.semester}
						</p>
					</div>
					<div className="section-heading-actions">
						{bank && <span className="count-badge">{bank.length}</span>}
						<button
							type="button"
							onClick={(event) => {
								editorOpener.current = event.currentTarget;
								setBankError("");
								setBankStatus("");
								setEditor({ kind: "create" });
							}}
						>
							Create question
						</button>
					</div>
				</div>
				<p className="helper-text">
					Shared only by lectures in this course and semester. Import questions
					once, then add the ones you need to the live queue.
				</p>
				<CsvImport
					course={course}
					canChangeCourse={canChangeCourse}
					onChangeCourse={onChangeCourse}
				/>
				{bankError && <p role="alert">{bankError}</p>}
				{bankStatus && <p role="status">{bankStatus}</p>}
				{(bank === undefined || bank === null || bank.length === 0) && (
					<p>
						{bank === undefined
							? "Opening question bank…"
							: bank === null
								? "Question bank unavailable."
								: "Your question bank is empty."}
					</p>
				)}
				{bank && bank.length > 0 && (
					<>
						<div className="bank-filters">
							<label>
								Search question bank
								<input
									type="search"
									placeholder="Search question text"
									value={bankQuery}
									onChange={(event) => {
										setBankQuery(event.currentTarget.value);
										setVisibleBankCount(bankPageSize);
									}}
								/>
							</label>
							<label>
								Question type
								<select
									value={bankType}
									onChange={(event) => {
										const selected = bankTypeOptions.find(
											([value]) => value === event.currentTarget.value,
										)?.[0];
										if (!selected) return;
										setBankType(selected);
										setVisibleBankCount(bankPageSize);
									}}
								>
									{bankTypeOptions.map(([value, label]) => (
										<option key={value} value={value}>
											{label}
										</option>
									))}
								</select>
							</label>
						</div>
						<p className="bank-result-count" aria-live="polite">
							Showing {Math.min(visibleBankCount, filteredBank.length)} of{" "}
							{filteredBank.length} matching questions
						</p>
					</>
				)}
				{bank && bank.length > 0 && filteredBank.length === 0 && (
					<p className="notice">
						No questions match. Try a shorter search or choose another question
						type.
					</p>
				)}
				<ul className="question-list bank-list">
					{visibleBank.map(({ id, revision, modifiedAt, question }) => (
						<li className="question-list-card" key={id}>
							<p className="question-prompt">{question.prompt}</p>
							<QuestionDetails question={question} />
							<div className="question-actions">
								<button
									className="secondary-button"
									type="button"
									onClick={(event) => {
										editorOpener.current = event.currentTarget;
										setBankError("");
										setBankStatus("");
										setEditor({
											kind: "edit",
											item: { id, revision, modifiedAt, question },
										});
									}}
								>
									Edit question
								</button>
								<button
									type="button"
									disabled={
										!plan || pending || awaitingUpdate || queued.has(id)
									}
									onClick={() => choose({ kind: "add", id })}
								>
									{queued.has(id) ? "In queue" : "Add to queue"}
								</button>
								<button
									className="danger-link"
									type="button"
									onClick={() => remove(id)}
								>
									Delete from bank
								</button>
							</div>
						</li>
					))}
				</ul>
				{filteredBank.length > bankPageSize && (
					<div className="bank-pagination">
						{visibleBankCount < filteredBank.length && (
							<button
								className="secondary-button"
								type="button"
								onClick={() =>
									setVisibleBankCount((count) => count + bankPageSize)
								}
							>
								Show 10 more
							</button>
						)}
						{visibleBankCount > bankPageSize && (
							<button
								className="secondary-button"
								type="button"
								onClick={() => setVisibleBankCount(bankPageSize)}
							>
								Show fewer
							</button>
						)}
					</div>
				)}
			</section>
			)}
			{view === "bank" && editor && (
				<QuestionEditor
					courseId={courseId}
					target={editor}
					onCancel={() => closeEditor()}
					onSaved={() => {
						if (editor.kind === "create") {
							setBankQuery("");
							setBankType("all");
							setVisibleBankCount(bankPageSize);
							closeEditor(
								"Question created and placed at the top of the bank.",
							);
						} else
							closeEditor(
								"Question updated. Existing lecture queue copies were not changed.",
							);
					}}
				/>
			)}
			{view === "queue" && (
			<section className="workspace-panel">
				<div className="section-heading">
					<div>
						<p className="eyebrow">Live control</p>
						<h2>Lecture queue</h2>
					</div>
					{plan && <span className="count-badge">{plan.items.length}</span>}
				</div>
				<p className="helper-text">
					Publish questions when students should see them. Hide or skip them
					without changing their order.
				</p>
				{!lectureId ? (
					<p>Open a lecture to manage its questions.</p>
				) : (
					<>
						{!plan && (
							<p role="status">
								{plan === null
									? "Question queue unavailable."
									: "Opening question queue…"}
							</p>
						)}
						{queueError && <p role="alert">{queueError}</p>}
						{retry && retry.id === lectureId && (
							<button
								type="button"
								disabled={pending}
								onClick={() => run(retry)}
							>
								Retry update
							</button>
						)}
						{plan && (
							<LectureQueue
								key={lectureId}
								lectureId={lectureId}
								plan={plan}
								pending={pending || awaitingUpdate}
								run={choose}
							/>
						)}
					</>
				)}
			</section>
			)}
		</div>
	);
}
