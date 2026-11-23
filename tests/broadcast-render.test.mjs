import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { broadcastLanguage } from "../functions/lib/broadcast.js";

test("broadcast previews render every supported grammar, line selection, and escaped markup", async () => {
	const samples = {
		plain: "Plain code",
		javascript: "const x = 1;",
		typescript: "const x: number = 1;",
		python: "def example():",
		java: "public class Example {}",
		c: "int main() {}",
		cpp: "namespace example {}",
		json: '{"x": true}',
		markup: "<strong>Hello</strong>",
		css: "p { color: green; }",
		bash: "if true; then echo hello; fi",
	};
	const server = await createServer({
		server: { middlewareMode: true, hmr: false },
		appType: "custom",
	});
	try {
		const { BroadcastPreview } = await server.ssrLoadModule(
			"/src/BroadcastPreview.tsx",
		);
		for (const language of broadcastLanguage.options) {
			const html = renderToStaticMarkup(
				createElement(BroadcastPreview, {
					document: {
						kind: "code",
						content: `${samples[language]}\n\n`,
						language,
						highlightedLines: [2],
					},
					toggle: () => {},
				}),
			);
			assert.match(html, /aria-label="Highlight line 2" aria-pressed="true"/);
			assert.match(html, /aria-label="Highlight line 3" aria-pressed="false"/);
			if (language === "plain") assert.match(html, /Plain code/);
			else assert.match(html, /class="token [^"]+/, language);
			if (language === "markup") {
				assert.match(html, /&lt;/);
				assert.doesNotMatch(html, /<strong>/);
			}
		}
	} finally {
		await server.close();
	}
});
