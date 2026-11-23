import { useEffect, useState } from "react";
import type { QuestionStats as Stats } from "../functions/src/answers";
import type { SessionId } from "../functions/src/contract";
import { optionLetters, type PublicQuestion } from "../functions/src/questions";
import { watchQuestionStats } from "./firebase";

export function QuestionStats({
	id,
	question,
}: {
	id: SessionId;
	question: PublicQuestion;
}) {
	const [stats, setStats] = useState<Stats | null | "unavailable">();
	useEffect(
		() => watchQuestionStats(id, question.id, setStats),
		[id, question.id],
	);
	if (stats === undefined)
		return <p role="status">Loading response statistics…</p>;
	if (stats === "unavailable")
		return <p role="status">Response statistics are unavailable.</p>;
	return (
		<div>
			<p>Responses: {stats?.total ?? 0}</p>
			{(question.type === "multiple-choice" ||
				question.type === "multiple-response") && (
				<ul>
					{question.options.map((option, index) => {
						const letter = optionLetters[index];
						return (
							<li key={letter}>
								{letter}. {option}:{" "}
								{stats?.type === "multiple-choice" ||
								stats?.type === "multiple-response"
									? (stats.counts[letter] ?? 0)
									: 0}
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}
