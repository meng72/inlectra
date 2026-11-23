export async function retryContention<T>(operation: () => Promise<T>) {
	for (let attempt = 0; attempt < 5; attempt++) {
		try {
			return await operation();
		} catch (error) {
			const exhausted =
				error instanceof Error && error.message.toLowerCase().includes("maxretry");
			if (!exhausted || attempt === 4) throw error;
			const backoff = 20 * 2 ** attempt + Math.floor(Math.random() * 20);
			await new Promise((resolve) => setTimeout(resolve, backoff));
		}
	}
	throw new Error("Transaction retry loop ended unexpectedly.");
}
