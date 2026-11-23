export function insertCodeTab(
	content: string,
	selectionStart: number,
	selectionEnd: number,
	limit: number,
) {
	const nextLength = content.length - (selectionEnd - selectionStart) + 1;
	if (nextLength > limit) return undefined;
	return {
		content: `${content.slice(0, selectionStart)}\t${content.slice(selectionEnd)}`,
		cursor: selectionStart + 1,
	};
}
