import { type ReactNode, useId, useState } from "react";
import { optionLetters, type PublicQuestion } from "../functions/src/questions";

export function QuestionNavigator({
	questions,
	renderQuestion,
}: {
	questions: PublicQuestion[];
	renderQuestion?: (question: PublicQuestion) => ReactNode;
}) {
	const selectId = useId();
	const [selection, setSelection] = useState({
		source: questions,
		id: questions[0]?.id,
		index: 0,
	});
	const found = questions.findIndex(({ id }) => id === selection.id);
	const index =
		found < 0
			? Math.max(0, Math.min(questions.length - 1, selection.index))
			: found;
	const question = questions[index];
	if (selection.source !== questions) {
		setSelection({ source: questions, id: question?.id, index });
	}
	function select(index: number) {
		setSelection({ source: questions, id: questions[index]?.id, index });
	}
	if (!question) return <p>No questions are available.</p>;
	return (
		<div className="question-navigator">
			<nav className="question-stepper" aria-label="Question navigation">
				<button
					className="secondary-button"
					type="button"
					disabled={index === 0}
					onClick={() => select(index - 1)}
				>
					Previous
				</button>
				<label htmlFor={selectId}>
					<span className="visually-hidden">Select question</span>
					<select
						id={selectId}
						value={index}
						onChange={(event) => select(Number(event.target.value))}
					>
						{questions.map(({ id }, i) => (
							<option key={id} value={i}>
								Question {i + 1} of {questions.length}
							</option>
						))}
					</select>
				</label>
				<button
					className="secondary-button"
					type="button"
					disabled={index === questions.length - 1}
					onClick={() => select(index + 1)}
				>
					Next
				</button>
			</nav>
			<div className="question-card" aria-live="polite">
				<p className="question-position">
					Question {index + 1} of {questions.length}
				</p>
				<p className="question-prompt">{question.prompt}</p>
				{renderQuestion ? (
					renderQuestion(question)
				) : question.type === "multiple-choice" ||
					question.type === "multiple-response" ? (
					<ol type="A">
						{question.options.map((option, i) => (
							<li key={optionLetters[i]}>{option}</li>
						))}
					</ol>
				) : (
					<p>
						{question.type === "numeric" ? "Numeric answer" : "Essay answer"}
					</p>
				)}
			</div>
		</div>
	);
}
