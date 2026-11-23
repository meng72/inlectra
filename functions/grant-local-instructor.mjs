import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const uid = process.argv[2];
if (!uid) throw new Error("Usage: npm run grant:instructor -- <emulator UID>");
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
const app = initializeApp({ projectId: "demo-inlectra" });
const auth = getAuth(app);
const user = await auth.getUser(uid);
await auth.setCustomUserClaims(uid, { ...user.customClaims, instructor: true });
process.stdout.write(
	"Instructor access granted locally. Sign out and sign in again.\n",
);
