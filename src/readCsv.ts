import Papa from "papaparse";

function checkQuotes(source: string) {
	let record = 1;
	let fieldStart = true;
	let quoted = false;
	for (let index = 0; index < source.length; index++) {
		const char = source[index];
		const next = source[index + 1];
		if (quoted) {
			if (char !== '"') continue;
			if (next === '"') {
				index++;
				continue;
			}
			if (next !== undefined && ![",", "\r", "\n"].includes(next)) {
				throw new Error(
					`Record ${record}: unexpected text after a quoted field.`,
				);
			}
			quoted = false;
		} else if (char === '"') {
			if (!fieldStart)
				throw new Error(`Record ${record}: quote inside an unquoted field.`);
			quoted = true;
			fieldStart = false;
		} else if (char === "\r" || char === "\n") {
			if (char === "\r" && next === "\n") index++;
			fieldStart = true;
			record++;
		} else {
			fieldStart = char === ",";
		}
	}
	if (quoted) throw new Error(`Record ${record}: unterminated quoted field.`);
}

export function readCsv(source: string) {
	const text = source.replace(/^\uFEFF/, "");
	checkQuotes(text);
	const parsed = Papa.parse<string[]>(text, {
		delimiter: ",",
		skipEmptyLines: true,
		fastMode: false,
	});
	if (parsed.errors.length) {
		throw new Error(
			parsed.errors
				.map(({ row, message }) =>
					row === undefined ? message : `Record ${row + 1}: ${message}`,
				)
				.join("\n"),
		);
	}
	return parsed.data;
}
