import type {
	QuestionContent,
	PlanOperation,
	QuestionPlan,
	QuestionState,
} from "./questions.js";
import { noReveals } from "./questions.js";

export function nextQuestionState(
	state: QuestionState,
	action: "publish" | "hide" | "skip" | "restore",
): QuestionState | undefined {
	switch (action) {
		case "publish":
			return state === "available" ? undefined : "available";
		case "hide":
			return state === "available" ? "hidden" : undefined;
		case "skip":
			return state === "skipped" ? undefined : "skipped";
		case "restore":
			return state === "hidden" || state === "skipped" ? "queued" : undefined;
	}
}

type PlanChange =
	| { kind: "applied"; plan: QuestionPlan }
	| { kind: "archived" | "stale" | "invalid" | "missing-question" };

export function changeQuestionPlan({
	state,
	plan,
	expectedRevision,
	operation,
	question,
	randomIndex,
}: {
	state: "open" | "archived";
	plan: QuestionPlan;
	expectedRevision: number;
	operation: PlanOperation;
	question?: QuestionContent;
	randomIndex: (limit: number) => number;
}): PlanChange {
	if (state === "archived") return { kind: "archived" };
	if (plan.revision !== expectedRevision) return { kind: "stale" };
	const items = [...plan.items];
	const applied = (): PlanChange => ({
		kind: "applied",
		plan: { items, revision: plan.revision + 1 },
	});
	if (operation.kind === "shuffle") {
		if (items.length < 2) return { kind: "invalid" };
		for (let i = items.length - 1; i > 0; i--) {
			const j = randomIndex(i + 1);
			[items[i], items[j]] = [items[j], items[i]];
		}
		if (items.every((item, index) => item.id === plan.items[index].id)) {
			[items[0], items[1]] = [items[1], items[0]];
		}
		return applied();
	}
	if (operation.kind === "publish-all" || operation.kind === "hide-all") {
		let changed = false;
		for (const [index, item] of items.entries()) {
			const stateAfter =
				operation.kind === "publish-all"
					? nextQuestionState(item.state, "publish")
					: nextQuestionState(item.state, "hide");
			if (!stateAfter) continue;
			items[index] = {
				id: item.id,
				question: item.question,
				state: stateAfter,
			};
			changed = true;
		}
		return changed ? applied() : { kind: "invalid" };
	}
	const index = items.findIndex((item) => item.id === operation.id);
	if (operation.kind === "add") {
		if (index >= 0) return { kind: "invalid" };
		if (!question) return { kind: "missing-question" };
		items.push({ id: operation.id, question, state: "queued" });
		return applied();
	}
	if (index < 0) return { kind: "missing-question" };
	if (operation.kind === "move") {
		const target = index + operation.by;
		if (target < 0 || target >= items.length) return { kind: "invalid" };
		[items[index], items[target]] = [items[target], items[index]];
		return applied();
	}
	const item = items[index];
	if (operation.kind === "reveal") {
		const reveals = item.reveals ?? noReveals;
		if (
			item.state !== "available" ||
			reveals[operation.target] === operation.visible ||
			(operation.target === "correctAnswer" && !item.question.correctAnswer)
		)
			return { kind: "invalid" };
		items[index] = {
			...item,
			reveals: { ...reveals, [operation.target]: operation.visible },
		};
		return applied();
	}
	const stateAfter = nextQuestionState(item.state, operation.kind);
	if (!stateAfter) return { kind: "invalid" };
	items[index] = { id: item.id, question: item.question, state: stateAfter };
	return applied();
}
