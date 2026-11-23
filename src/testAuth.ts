import {
	GoogleAuthProvider,
	signInWithCredential,
} from "firebase/auth";
import { auth } from "./firebase";

function requireLocalDevelopment() {
	if (
		!import.meta.env.DEV ||
		!new Set(["127.0.0.1", "localhost"]).has(location.hostname)
	)
		throw new Error("Synthetic sign-in is available only on a local dev server.");
}

export async function signInSyntheticGoogle(identity: {
	sub: string;
	email: string;
	name?: string;
}) {
	requireLocalDevelopment();
	const result = await signInWithCredential(
		auth,
		GoogleAuthProvider.credential(
			JSON.stringify({ ...identity, email_verified: true }),
		),
	);
	return { uid: result.user.uid };
}

export async function refreshSyntheticToken() {
	requireLocalDevelopment();
	if (!auth.currentUser) throw new Error("No synthetic user is signed in.");
	await auth.currentUser.getIdToken(true);
}
