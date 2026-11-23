import { z } from "zod";
import type { SessionId } from "../functions/src/contract";

const draftRecord = z.strictObject({
	content: z.string(),
	broadcastRevision: z.number().int().positive(),
	updatedAt: z.number(),
});
export type CodeDraft = z.infer<typeof draftRecord>;
export type DraftScope = { uid: string; id: SessionId };

export function createDraftStore(
	factory: IDBFactory,
	name = "inlectra-private",
) {
	async function transact<T>(
		mode: IDBTransactionMode,
		operation: (store: IDBObjectStore) => IDBRequest<T>,
	) {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = factory.open(name, 1);
			request.onupgradeneeded = () =>
				request.result.createObjectStore("codeDrafts");
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		try {
			return await new Promise<T>((resolve, reject) => {
				const transaction = db.transaction("codeDrafts", mode);
				const request = operation(transaction.objectStore("codeDrafts"));
				transaction.oncomplete = () => resolve(request.result);
				transaction.onabort = () => reject(transaction.error ?? request.error);
			});
		} finally {
			db.close();
		}
	}
	return {
		async read({ uid, id }: DraftScope) {
			const value: unknown = await transact("readonly", (store) =>
				store.get([uid, id]),
			);
			return value === undefined ? null : draftRecord.parse(value);
		},
		async write({ uid, id }: DraftScope, draft: CodeDraft) {
			await transact("readwrite", (store) => store.put(draft, [uid, id]));
		},
		async remove({ uid, id }: DraftScope) {
			await transact("readwrite", (store) => store.delete([uid, id]));
		},
		async removeAccount(uid: string) {
			const keys = await transact("readonly", (store) => store.getAllKeys());
			await Promise.all(
				keys
					.filter((key) => Array.isArray(key) && key[0] === uid)
					.map((key) =>
						transact("readwrite", (store) => store.delete(key)),
					),
			);
		},
	};
}
