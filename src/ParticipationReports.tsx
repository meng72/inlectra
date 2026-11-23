import { useState, type FormEvent } from "react";
import { operationId, type SessionId } from "../functions/src/contract";
import {
	maxRosterRows,
	rosterHeaders,
	type ReportingSummary,
	type RosterImportRequest,
	type UnmatchedAccount,
	validateRosterRows,
} from "../functions/src/reporting";
import { createReport, getReportingSummary, importRoster } from "./firebase";
import { readCsv } from "./readCsv";

const maxRosterBytes = 1024 * 1024;

function saveCsv(filename: string, csv: string) {
	const url = URL.createObjectURL(
		new Blob([csv], { type: "text/csv;charset=utf-8" }),
	);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	link.click();
	URL.revokeObjectURL(url);
}

export default function ParticipationReports({
	id,
	standalone = false,
}: {
	id: SessionId;
	standalone?: boolean;
}) {
	const [summary, setSummary] = useState<ReportingSummary | null>();
	const [rows, setRows] = useState<string[][]>();
	const [errors, setErrors] = useState<string[]>([]);
	const [busy, setBusy] = useState(false);
	const [statusBusy, setStatusBusy] = useState(false);
	const [pending, setPending] = useState<RosterImportRequest>();
	const [message, setMessage] = useState("");
	const [unmatched, setUnmatched] = useState<UnmatchedAccount[]>([]);
	const preview = rows ? validateRosterRows(rows) : undefined;

	async function refreshStatus() {
		if (busy) return;
		setBusy(true);
		setStatusBusy(true);
		setMessage("");
		try {
			const current = await getReportingSummary(id);
			setSummary(current);
			setMessage(
				`Current status: ${current.joinedCount} students joined, ${current.participatingCount} submitted an answer, and ${current.participationPoints} participation points awarded.`,
			);
		} catch {
			setSummary(null);
			setMessage("Could not refresh the current participation status.");
		} finally {
			setStatusBusy(false);
			setBusy(false);
		}
	}

	async function choose(file?: File) {
		setRows(undefined);
		setErrors([]);
		setPending(undefined);
		setMessage("");
		if (!file) return;
		if (file.size > maxRosterBytes) {
			setErrors(["Choose a roster CSV no larger than 1 MB."]);
			return;
		}
		try {
			const parsed = readCsv(await file.text());
			const validated = validateRosterRows(parsed);
			if (!validated.ok) setErrors([...validated.errors]);
			else setRows(parsed);
		} catch (error) {
			setErrors([
				error instanceof Error ? error.message : "Could not read CSV.",
			]);
		}
	}

	async function replaceRoster(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!rows || !summary || busy) return;
		const form = event.currentTarget;
		const request =
			pending ??
			({
				id,
				rows,
				expectedRevision: summary.rosterRevision,
				operationId: operationId.parse(crypto.randomUUID()),
			} satisfies RosterImportRequest);
		setBusy(true);
		setMessage("");
		try {
			const receipt = await importRoster(request);
			setSummary((current) =>
				current
					? {
							...current,
							rosterRevision: receipt.revision,
							rosterCount: receipt.count,
						}
					: current,
			);
			setRows(undefined);
			form.reset();
			setPending(undefined);
			setMessage(`Roster revision ${receipt.revision} saved.`);
		} catch (error) {
			const code =
				error && typeof error === "object" && "code" in error ? error.code : "";
			if (code === "functions/aborted") {
				setPending(undefined);
				try {
					setSummary(await getReportingSummary(id));
				} catch {
					setSummary(null);
				}
				setMessage(
					"The roster changed in another window. Review this file before replacing the newer roster.",
				);
			} else if (
				code === "functions/invalid-argument" ||
				code === "functions/permission-denied"
			) {
				setPending(undefined);
				setMessage("The roster could not be saved. Check the file and access.");
			} else {
				setPending(request);
				setMessage(
					"Could not confirm the roster change. Retry the same request.",
				);
			}
		} finally {
			setBusy(false);
		}
	}

	async function download(kind: "participation" | "canvas") {
		if (busy) return;
		setBusy(true);
		setMessage("");
		setUnmatched([]);
		try {
			const report = await createReport(id, kind);
			saveCsv(report.filename, report.csv);
			setUnmatched(report.unmatched);
			setMessage(
				kind === "canvas"
					? `Downloaded ${report.rowCount} matched Canvas records. ${report.unmatched.length} accounts need review.`
					: `Downloaded ${report.rowCount} participation records.`,
			);
		} catch {
			setMessage("Could not create the report. Check your instructor access.");
		} finally {
			setBusy(false);
		}
	}

	return (
		<details
			className={`reporting-section${standalone ? " standalone-section" : ""}`}
			open={standalone}
		>
			<summary>Participation reports</summary>
			<div className="report-status-heading">
				<div>
					<h4>Current session status</h4>
					<p className="helper-text">
						Counts update only when you request a fresh snapshot.
					</p>
				</div>
				<button type="button" disabled={busy} onClick={refreshStatus}>
					{statusBusy ? "Refreshing…" : "Refresh current status"}
				</button>
			</div>
			{summary === undefined && (
				<p className="notice">Current status has not been loaded yet.</p>
			)}
			{summary === null && (
				<p role="alert">Current participation status is unavailable.</p>
			)}
			{summary && (
				<>
					<fieldset className="report-metrics">
						<legend className="visually-hidden">Current session status</legend>
						<div>
							<strong>{summary.joinedCount}</strong>
							<span className="report-metric-label">Students joined</span>
						</div>
						<div>
							<strong>{summary.participatingCount}</strong>
							<span className="report-metric-label">Submitted an answer</span>
						</div>
						<div>
							<strong>{summary.participationPoints}</strong>
							<span className="report-metric-label">Points awarded</span>
						</div>
						<div>
							<strong>{summary.rosterCount}</strong>
							<span className="report-metric-label">Roster records</span>
						</div>
					</fieldset>
					<p className="report-snapshot-time">
						Snapshot taken {new Date(summary.generatedAt).toLocaleTimeString()}.
					</p>
				</>
			)}
			<p>
				Lecture joining does not verify enrollment. Import an
				instructor-provided roster before creating a Canvas report.
			</p>
			<p>
				Roster format: <code>{rosterHeaders.join(",")}</code>. Include 1 to{" "}
				{maxRosterRows} records.
			</p>
			{summary && (
				<p>
					Current roster: revision {summary.rosterRevision},{" "}
					{summary.rosterCount} records.
				</p>
			)}
			<form onSubmit={replaceRoster}>
				<label>
					Roster CSV
					<input
						type="file"
						accept=".csv,text/csv"
						disabled={busy}
						onChange={(event) => void choose(event.currentTarget.files?.[0])}
					/>
				</label>
				{rows && (
					<>
						<p>Ready to replace the roster with {rows.length - 1} records.</p>
						{preview?.ok && (
							<div className="roster-preview">
								<table>
									<thead>
										<tr>
											<th>Email</th>
											<th>Display name</th>
											<th>Canvas identifier</th>
										</tr>
									</thead>
									<tbody>
										{preview.entries.slice(0, 10).map((entry) => (
											<tr key={entry.email}>
												<td>{entry.email}</td>
												<td>{entry.displayName ?? ""}</td>
												<td>{entry.canvasIdentifier}</td>
											</tr>
										))}
									</tbody>
								</table>
								{preview.entries.length > 10 && (
									<p>Showing the first 10 records.</p>
								)}
							</div>
						)}
					</>
				)}
				{errors.length > 0 && (
					<ul className="errors" role="alert">
						{errors.map((error) => (
							<li key={error}>{error}</li>
						))}
					</ul>
				)}
				<button type="submit" disabled={!rows || !summary || busy}>
					{pending ? "Retry roster import" : "Replace roster"}
				</button>
				{!summary && (
					<p className="field-hint">
						Refresh current status before replacing the roster.
					</p>
				)}
			</form>
			<div className="question-actions">
				<button
					type="button"
					disabled={busy}
					onClick={() => download("participation")}
				>
					Download participation CSV
				</button>
				<button
					type="button"
					disabled={busy}
					onClick={() => download("canvas")}
				>
					Download Canvas CSV
				</button>
			</div>
			{unmatched.length > 0 && (
				<div>
					<h4>Accounts requiring review</h4>
					<ul>
						{unmatched.map((account) => (
							<li
								key={`${account.email}:${account.displayName ?? ""}:${account.reason}`}
							>
								{account.email}
								{account.displayName ? ` (${account.displayName})` : ""}:{" "}
								{account.reason === "no-roster-match"
									? "no roster match"
									: "the same email belongs to multiple joined accounts"}
							</li>
						))}
					</ul>
				</div>
			)}
			{message && <p role="status">{message}</p>}
		</details>
	);
}
