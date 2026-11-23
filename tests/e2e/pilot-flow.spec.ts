import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
const admin = initializeApp({ projectId: "demo-inlectra" });

async function syntheticSignIn(
	page: Page,
	identity: { sub: string; email: string; name: string },
) {
	return page.evaluate(async (value) => {
		const auth = await import("/src/testAuth.ts");
		return auth.signInSyntheticGoogle(value);
	}, identity);
}

test.afterAll(async () => deleteApp(admin));

test("instructor and student complete the local pilot path", async ({
	browser,
}) => {
	const instructor = await browser.newPage();
	await instructor.goto("/");
	await expect(
		instructor.getByRole("heading", { name: "Start or join a live class" }),
	).toBeVisible();
	await expect(
		instructor.getByText(
			"Sign in with Google to create a lecture as an instructor or join one as a student.",
		),
	).toBeVisible();
	await expect(instructor.getByText("Local emulator")).toHaveCount(0);
	await expect(instructor.getByText(/fictional Google account/i)).toHaveCount(
		0,
	);
	const instructorIdentity = {
		sub: randomUUID(),
		email: `instructor-${randomUUID()}@example.test`,
		name: "Synthetic Instructor",
	};
	const { uid } = await syntheticSignIn(instructor, instructorIdentity);
	await getAuth(admin).setCustomUserClaims(uid, { instructor: true });
	await instructor.evaluate(async () => {
		const auth = await import("/src/testAuth.ts");
		await auth.refreshSyntheticToken();
	});
	await expect(
		instructor.getByRole("heading", { name: "Course workspace" }),
	).toBeVisible();
	await expect(
		instructor.getByRole("button", { name: "Teach a class" }),
	).toHaveAttribute("aria-pressed", "true");
	await instructor
		.getByText("Create a course workspace", { exact: true })
		.click();
	await instructor.getByLabel("Course number").fill("CSE 4333");
	await instructor.getByLabel("Semester").fill("Fall 2026");
	await instructor.getByRole("button", { name: "Create course" }).click();
	await expect(instructor.getByLabel("Course workspace")).toHaveValue(
		/^[0-9a-f-]{36}$/,
	);
	await instructor.getByRole("tab", { name: "Question bank" }).click();
	const preLectureImport = instructor.locator("details.csv-import");
	await preLectureImport.getByText("Import questions from CSV").click();
	await expect(
		preLectureImport.getByRole("button", { name: "Change course" }),
	).toBeVisible();
	await preLectureImport
		.getByRole("button", { name: "Change course" })
		.click();
	await expect(instructor.getByLabel("Course workspace")).toBeFocused();
	await preLectureImport.getByText("Import questions from CSV").click();
	await instructor.getByRole("tab", { name: "Lectures" }).click();
	await expect(
		instructor.getByRole("heading", { name: "Start a live lecture" }),
	).toBeVisible();
	await instructor.getByLabel("Lecture title").fill("Synthetic pilot lecture");
	await instructor.getByRole("button", { name: "Create session" }).click();
	const sessionCode = await instructor
		.locator(".receipt code")
		.first()
		.textContent();
	expect(sessionCode).toMatch(/^[A-F0-9]{12}$/);
	await expect(instructor.locator(".session-setup")).toHaveCount(0);
	await expect(
		instructor.getByText("CSE 4333 · Fall 2026", { exact: true }),
	).toBeVisible();
	await expect(
		instructor.getByRole("tab", { name: "Live control" }),
	).toHaveAttribute("aria-selected", "true");
	await expect(
		instructor.getByRole("heading", { name: "Lecture queue" }),
	).toBeVisible();
	await expect(
		instructor.getByRole("heading", { name: "Question bank" }),
	).toHaveCount(0);
	const liveTab = instructor.getByRole("tab", { name: "Live control" });
	await liveTab.focus();
	await liveTab.press("ArrowRight");
	await expect(
		instructor.getByRole("tab", { name: "Question bank" }),
	).toBeFocused();
	await instructor
		.getByRole("tab", { name: "Question bank" })
		.press("ArrowLeft");
	await expect(liveTab).toBeFocused();

	const qrPopupPromise = instructor.waitForEvent("popup");
	await instructor
		.getByRole("link", { name: "Open QR code in presentation tab" })
		.click();
	const qrPopup = await qrPopupPromise;
	await expect(
		qrPopup.getByRole("heading", { name: "Join InLectra" }),
	).toBeVisible();
	await expect(
		qrPopup.getByText(sessionCode as string, { exact: true }),
	).toBeVisible();
	await expect(
		qrPopup.getByRole("img", {
			name: "Scan to join this InLectra lecture",
		}),
	).toBeVisible();
	await qrPopup.close();
	await instructor.getByRole("tab", { name: "Question bank" }).click();
	await expect(
		instructor.getByRole("heading", { name: "Question bank" }),
	).toBeVisible();

	const questionImport = instructor.locator("details.csv-import");
	await questionImport.getByText("Import questions from CSV").click();
	await expect(questionImport.getByText("Importing into")).toBeVisible();
	await expect(
		questionImport.getByText("CSE 4333 · Fall 2026", { exact: true }),
	).toBeVisible();
	await expect(questionImport.getByText("Fixed for this lecture")).toBeVisible();
	await questionImport.locator('input[type="file"]').setInputFiles({
		name: "questions.csv",
		mimeType: "text/csv",
		buffer: Buffer.from(
			[
				"Type,Title,Points,Question,Answer,Choice1,Choice2,Choice3,Choice4,Choice5",
				"MR,,1,Select all ready states.,13,Ready,Waiting,Prepared,,",
				...Array.from(
					{ length: 11 },
					(_, index) => `MC,,1,Practice question ${index + 2},1,Yes,No,,,`,
				),
			].join("\n"),
		),
	});
	await questionImport
		.getByRole("button", { name: "Import questions" })
		.click();
	await expect(questionImport.getByRole("status")).toContainText(
		"Imported 12 questions",
	);
	const bank = instructor.locator(".bank-list");
	await expect(bank.locator(".question-list-card")).toHaveCount(10);
	await instructor.getByRole("button", { name: "Create question" }).click();
	const createEditor = instructor.getByRole("dialog", {
		name: "Create question",
	});
	await createEditor.getByLabel("Question type").selectOption("short-answer");
	await createEditor
		.getByRole("textbox", { name: "Question", exact: true })
		.fill("Created live question");
	await createEditor.getByLabel("Answer key (optional)").fill("Live answer");
	await createEditor.getByRole("button", { name: "Create question" }).click();
	await expect(
		instructor
			.getByRole("status")
			.filter({ hasText: "Question created and placed at the top" }),
	).toBeVisible();
	await expect(
		bank
			.locator(".question-list-card")
			.first()
			.getByText("Created live question"),
	).toBeVisible();
	await expect(
		instructor.getByRole("button", { name: "Show 10 more" }),
	).toBeVisible();
	await instructor
		.getByLabel("Search question bank")
		.fill("Practice question 12");
	await expect(bank.locator(".question-list-card")).toHaveCount(1);
	await expect(
		bank.getByText("Practice question 12", { exact: true }),
	).toBeVisible();
	await bank
		.locator(".question-list-card")
		.filter({ hasText: "Practice question 12" })
		.getByRole("button", { name: "Edit question" })
		.click();
	const questionEditor = instructor.getByRole("dialog", {
		name: "Edit question",
	});
	await expect(questionEditor).toBeVisible();
	for (const viewport of [
		{ width: 375, height: 812 },
		{ width: 812, height: 375 },
	]) {
		await instructor.setViewportSize(viewport);
		const pageWidth = await instructor.evaluate(() => ({
			clientWidth: document.documentElement.clientWidth,
			scrollWidth: document.documentElement.scrollWidth,
		}));
		expect(pageWidth.scrollWidth).toBeLessThanOrEqual(pageWidth.clientWidth);
		expect(
			await questionEditor.evaluate(
				(element) => element.scrollWidth <= element.clientWidth,
			),
		).toBe(true);
	}
	await instructor.setViewportSize({ width: 1280, height: 720 });
	await questionEditor
		.getByLabel("Question")
		.fill("Revised practice question 12");
	await questionEditor.getByRole("button", { name: "Save changes" }).click();
	await expect(
		instructor
			.getByRole("status")
			.filter({ hasText: "Existing lecture queue copies were not changed" }),
	).toBeVisible();
	await expect(instructor.getByLabel("Search question bank")).toHaveValue(
		"Practice question 12",
	);
	await instructor
		.getByLabel("Search question bank")
		.fill("Revised practice question 12");
	await expect(
		bank.getByText("Revised practice question 12", { exact: true }),
	).toBeVisible();
	await instructor.getByLabel("Search question bank").fill("");
	await expect(
		bank
			.locator(".question-list-card")
			.first()
			.getByText("Revised practice question 12"),
	).toBeVisible();
	await instructor
		.getByLabel("Search question bank")
		.fill("Select all ready states");
	await bank
		.locator(".question-list-card")
		.filter({ hasText: "Select all ready states." })
		.getByRole("button", { name: "Add to queue" })
		.click();
	await instructor.getByRole("tab", { name: "Live control" }).click();
	await instructor.getByRole("button", { name: "Publish all" }).click();
	await expect(instructor.locator(".question-state")).toHaveText("available");
	await instructor.getByRole("button", { name: "Hide all" }).click();
	await expect(instructor.locator(".question-state")).toHaveText("hidden");
	await instructor.getByRole("button", { name: "Publish all" }).click();
	await expect(instructor.locator(".question-state")).toHaveText("available");

	const studentContext = await browser.newContext({
		viewport: { width: 375, height: 812 },
	});
	const student = await studentContext.newPage();
	const studentIdentity = {
		sub: randomUUID(),
		email: `student-${randomUUID()}@example.test`,
		name: "Synthetic Student",
	};
	await student.goto(`/?join=${sessionCode}`);
	await syntheticSignIn(student, studentIdentity);
	await expect(
		student.getByRole("heading", { name: "Student workspace" }),
	).toBeVisible();
	await student.getByRole("button", { name: "Join lecture" }).click();
	await expect(
		student.getByRole("heading", { name: "Synthetic pilot lecture" }),
	).toBeVisible();
	await expect(
		student.getByText("CSE 4333 · Fall 2026", { exact: true }),
	).toBeVisible();
	await expect(
		student.getByRole("status").filter({ hasText: "Joined live" }),
	).toBeVisible();
	const activitiesTab = student.getByRole("tab", { name: "Activities" });
	await expect(activitiesTab).toHaveAttribute("aria-selected", "true");
	await activitiesTab.focus();
	await activitiesTab.press("ArrowRight");
	await expect(student.getByRole("tab", { name: "Whiteboard" })).toBeFocused();
	await student.getByRole("tab", { name: "Class Q&A" }).click();
	await expect(
		student.getByRole("heading", { name: "Ask a question" }),
	).toBeVisible();
	const studentQuestions = student.locator(".student-question-desk");
	await studentQuestions
		.getByLabel("Your question")
		.fill("Could you explain why Ready is correct?");
	await studentQuestions.getByRole("button", { name: "Send question" }).click();
	await expect(studentQuestions.getByRole("status")).toContainText(
		"sent privately to the instructor",
	);
	await expect(
		instructor.getByRole("button", { name: /Student questions, 1 open/ }),
	).toBeVisible();
	await instructor
		.getByRole("button", { name: /Student questions, 1 open/ })
		.click();
	const questionDrawer = instructor.getByRole("dialog", {
		name: "Student question inbox",
	});
	const questionInbox = questionDrawer.locator(".question-inbox");
	await expect(
		questionInbox.getByText("Could you explain why Ready is correct?"),
	).toBeVisible();
	await expect(questionInbox.getByText("Synthetic Student")).toHaveCount(0);
	await questionInbox.getByLabel("Show student identities").check();
	await expect(questionInbox.getByText("Synthetic Student")).toBeVisible();
	await questionInbox
		.getByRole("button", { name: "Publish anonymously" })
		.click();
	await expect(questionInbox.getByRole("status")).toContainText(
		"Published an anonymous copy",
	);
	await expect(
		studentQuestions
			.locator(".published-question-list")
			.getByText("Could you explain why Ready is correct?"),
	).toBeVisible();
	await questionInbox.getByRole("button", { name: "Mark answered" }).click();
	await expect(
		studentQuestions.locator(".published-question-list .status-pill"),
	).toHaveText("Answered");
	for (let index = 2; index <= 6; index += 1) {
		const question = `Anonymous question ${index}`;
		await studentQuestions.getByLabel("Your question").fill(question);
		await studentQuestions
			.getByRole("button", { name: "Send question" })
			.click();
		const inboxCard = questionInbox.locator(".inbox-card").filter({
			hasText: question,
		});
		await expect(inboxCard).toBeVisible();
		await inboxCard
			.getByRole("button", { name: "Publish anonymously" })
			.click();
	}
	await expect(
		studentQuestions.locator(".published-question-list article"),
	).toHaveCount(5);
	await studentQuestions
		.getByRole("button", { name: "Show 1 more class question" })
		.click();
	await expect(
		studentQuestions.locator(".published-question-list article"),
	).toHaveCount(6);
	await questionDrawer.getByRole("button", { name: "Close inbox" }).click();
	expect(
		await student.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);
	await student.setViewportSize({ width: 812, height: 375 });
	expect(
		await student.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);
	await student.setViewportSize({ width: 375, height: 812 });
	await activitiesTab.click();
	await expect(
		student.getByText("Select all ready states.", { exact: true }),
	).toBeVisible();
	await student.getByLabel("A. Ready").check();
	await student.getByLabel("C. Prepared").check();
	await student.getByRole("button", { name: "Submit answer" }).click();
	await expect(
		student.getByRole("status").filter({ hasText: "Participation earned" }),
	).toContainText("Participation earned: 1");

	const broadcast = instructor.locator("details.broadcast-section");
	await expect(broadcast).toHaveAttribute("open", "");
	await broadcast.getByLabel("Format").selectOption("code");
	const codeEditor = broadcast.getByLabel("Broadcast content");
	await codeEditor.fill("function ready() {\n");
	await codeEditor.press("Tab");
	await expect(codeEditor).toHaveValue("function ready() {\n\t");
	expect(
		await codeEditor.evaluate((element) => getComputedStyle(element).tabSize),
	).toBe("4");
	await codeEditor.pressSequentially("return true;\n}");
	const codePreview = broadcast.locator(".broadcast-preview code").first();
	await expect(codePreview).toBeVisible();
	expect(
		await codePreview.evaluate((element) => getComputedStyle(element).tabSize),
	).toBe("4");
	await broadcast.getByRole("button", { name: "Send broadcast" }).click();
	await expect(broadcast.getByRole("status")).toContainText("Broadcast sent");
	await student.getByRole("tab", { name: "Whiteboard" }).click();
	await expect(
		student.getByRole("heading", { name: "Whiteboard" }),
	).toBeVisible();
	await expect(student.locator(".broadcast-preview")).toContainText(
		"return true;",
	);

	await instructor.getByRole("tab", { name: "Reports" }).click();
	const reports = instructor.locator(".reporting-section");
	await expect(
		reports.getByText("Current status has not been loaded yet"),
	).toBeVisible();
	await reports.getByRole("button", { name: "Refresh current status" }).click();
	await expect(
		reports
			.locator(".report-metrics > div")
			.filter({ hasText: "Students joined" })
			.locator("strong"),
	).toHaveText("1");
	await expect(
		reports
			.locator(".report-metrics > div")
			.filter({ hasText: "Submitted an answer" })
			.locator("strong"),
	).toHaveText("1");
	await instructor.setViewportSize({ width: 375, height: 812 });
	expect(
		await instructor.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);
	await instructor.setViewportSize({ width: 1280, height: 720 });
	await reports.getByLabel("Roster CSV").setInputFiles({
		name: "roster.csv",
		mimeType: "text/csv",
		buffer: Buffer.from(
			`email,display_name,canvas_identifier\n${studentIdentity.email},Synthetic Student,canvas-synthetic-1\n`,
		),
	});
	await reports.getByRole("button", { name: "Replace roster" }).click();
	await expect(reports.getByRole("status")).toContainText(
		"Roster revision 1 saved",
	);
	const downloadPromise = instructor.waitForEvent("download");
	await reports.getByRole("button", { name: "Download Canvas CSV" }).click();
	const download = await downloadPromise;
	const downloadPath = await download.path();
	expect(downloadPath).not.toBeNull();
	const csv = await readFile(downloadPath as string, "utf8");
	expect(csv).toContain('"canvas-synthetic-1","1"');

	await instructor.getByRole("button", { name: "End class" }).click();
	await instructor.getByRole("button", { name: "Confirm end class" }).click();
	await expect(
		instructor.getByRole("status").filter({ hasText: "Archived" }),
	).toBeVisible();
	await instructor.getByRole("button", { name: "Back to archives" }).click();
	await expect(
		instructor.getByRole("heading", { name: "Archived lectures" }),
	).toBeVisible();
	await expect(
		instructor.locator(".course-lecture-list").getByText("Synthetic pilot lecture"),
	).toBeVisible();
	await instructor.getByRole("button", { name: "View archive" }).click();
	const deletion = instructor.locator("details", {
		hasText: "Permanently delete lecture data",
	});
	await deletion.getByText("Permanently delete lecture data").click();
	await deletion.getByLabel("Session code").fill(sessionCode as string);
	await deletion.getByRole("button", { name: "Delete lecture data" }).click();
	await expect(
		instructor.getByRole("heading", { name: "Archived lectures" }),
	).toBeVisible();
	await expect(instructor.getByText("No archived lectures in this course.")).toBeVisible();
	await studentContext.close();
});
