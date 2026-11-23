import { useEffect, useRef, useState } from "react";
import type { SessionId } from "../functions/src/contract";
import { type CodeDraft, createDraftStore } from "./codeDraftStore";

const pendingWrites = new Map<string, Promise<void>>();

export function useCodeDraft(uid: string, id: SessionId) {
	const [draft, setDraft] = useState<CodeDraft | null>();
	const [status, setStatus] = useState<
		"loading" | "saving" | "saved" | "error"
	>("loading");
	const generation = useRef(0);
	const key = JSON.stringify([uid, id]);

	useEffect(() => {
		let active = true;
		void Promise.resolve(pendingWrites.get(key))
			.then(() => createDraftStore(indexedDB).read({ uid, id }))
			.then(
				(value) => {
					if (active) {
						setDraft(value);
						setStatus("saved");
					}
				},
				() => {
					if (active) setStatus("error");
				},
			);
		return () => {
			active = false;
			generation.current++;
		};
	}, [uid, id, key]);

	function save(value: CodeDraft | null) {
		setDraft(value);
		setStatus("saving");
		const version = ++generation.current;
		const write = Promise.resolve(pendingWrites.get(key))
			.then(async () => {
				const store = createDraftStore(indexedDB);
				if (value) await store.write({ uid, id }, value);
				else await store.remove({ uid, id });
			})
			.then(
				() => {
					if (version === generation.current) setStatus("saved");
				},
				() => {
					if (version === generation.current) setStatus("error");
				},
			);
		pendingWrites.set(key, write);
		void write.then(() => {
			if (pendingWrites.get(key) === write) pendingWrites.delete(key);
		});
	}
	return { draft, status, save };
}
