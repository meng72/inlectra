import { Fragment, type ReactNode } from "react";
import { Highlight, themes } from "prism-react-renderer";
import Prism from "prismjs";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-css";
import "prismjs/components/prism-clike";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-python";
import "prismjs/components/prism-java";
import "prismjs/components/prism-c";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-json";
import "prismjs/components/prism-bash";
import {
	splitBroadcastLines,
	type BroadcastBody,
} from "../functions/src/broadcast";

export function BroadcastPreview({
	document,
	toggle,
}: {
	document: BroadcastBody;
	toggle?: (line: number) => void;
}) {
	const lines = splitBroadcastLines(document.content);
	const highlights = new Set(document.highlightedLines);
	function row(content: ReactNode, index: number) {
		const line = index + 1;
		const selected = highlights.has(line);
		return (
			<div
				className={
					selected ? "broadcast-line is-highlighted" : "broadcast-line"
				}
				key={line}
			>
				{toggle ? (
					<button
						type="button"
						aria-label={`Highlight line ${line}`}
						aria-pressed={selected}
						onClick={() => toggle(line)}
					>
						{line}
					</button>
				) : (
					<span className="broadcast-line-number" aria-hidden="true">
						{line}
					</span>
				)}
				{document.kind === "code" ? (
					<code>{content}</code>
				) : (
					<span>{content}</span>
				)}
			</div>
		);
	}
	if (document.kind === "text" || document.language === "plain")
		return <div className="broadcast-preview">{lines.map(row)}</div>;
	return (
		<Highlight
			prism={Prism}
			theme={themes.github}
			language={document.language}
			code={lines.join("\n")}
		>
			{({ tokens, getTokenProps }) => (
				<div className="broadcast-preview">
					{lines.map((original, index) => {
						const line = tokens[index];
						let offset = 0;
						return row(
							line
								? line.map((token) => {
										const start = offset;
										offset += token.content.length;
										return (
											<Fragment key={start}>
												<span {...getTokenProps({ token })} />
											</Fragment>
										);
									})
								: original,
							index,
						);
					})}
				</div>
			)}
		</Highlight>
	);
}
