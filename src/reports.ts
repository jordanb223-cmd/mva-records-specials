import { App, Modal, moment, Notice, Setting, TFile } from "obsidian";
import { caseFolder, ensureFolder, fileName, freePath } from "./attachments";
import type { CaseData } from "./dashboard";
import {
	balance,
	dueDate,
	formatDate,
	formatMoney,
	formatShortDate,
	GAP_LABEL,
	gaps,
	isOpen,
	isOverdue,
	paid,
	requestStatus,
	SpecialsTotals,
	STATUS_LABEL,
	today,
	totalsByRelatedness,
} from "./data";
import { Cell, PdfWriter, Row } from "./pdf";
import { Attachment, Encounter, MvaSettings, RecordRequest } from "./types";

export type SectionKey = "summary" | "requests" | "missing" | "specials" | "gaps" | "fees" | "documents";

export const SECTION_LABEL: Record<SectionKey, string> = {
	summary: "Summary",
	requests: "Records request log",
	missing: "Still missing",
	specials: "Medical specials",
	gaps: "Documentation gaps",
	fees: "Fees and receipts",
	documents: "Index of documents on file",
};

export interface ReportOptions {
	title: string;
	sections: SectionKey[];
	notes: string;
	appendDocuments: boolean;
	privileged: boolean;
}

export const PRESETS: Record<string, { title: string; sections: SectionKey[]; appendDocuments: boolean }> = {
	"Case status update": { title: "Case Status Update", sections: ["summary", "requests", "missing", "specials", "gaps", "fees", "documents"], appendDocuments: false },
	"Request log": { title: "Records Request Log", sections: ["requests", "missing", "fees"], appendDocuments: false },
	"Specials summary": { title: "Medical Specials Summary", sections: ["specials", "gaps", "fees"], appendDocuments: true },
};

export interface CaseInfo {
	file: TFile;
	name: string;
	client: string;
	doi: string;
}

export function caseInfo(app: App, c: CaseData): CaseInfo {
	const fm = app.metadataCache.getFileCache(c.file)?.frontmatter ?? {};
	const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
	return { file: c.file, name: c.name, client: s(fm.client) || c.name, doi: s(fm.doi) || s(fm.date_of_incident) };
}

function money(settings: MvaSettings): (n: number | null) => string {
	return (n) => formatMoney(n, settings.currency);
}

function header(w: PdfWriter, settings: MvaSettings, info: CaseInfo, title: string, privileged: boolean): void {
	if (privileged) w.text("PRIVILEGED AND CONFIDENTIAL - ATTORNEY WORK PRODUCT", { size: 8, bold: true, color: "alert", gap: 4 });
	if (settings.firmName) w.text(settings.firmName.toUpperCase(), { size: 9, bold: true, color: "muted" });
	w.text(title, { size: 18, bold: true, gap: 4 });
	w.keyValues([
		["Case", info.client],
		["Date of incident", info.doi ? formatShortDate(info.doi) : ""],
		["Prepared by", settings.preparedBy],
		["Date", moment().format("MMMM D, YYYY")],
	]);
	w.rule();
	w.space(6);
}

function requestRow(r: RecordRequest, m: (n: number | null) => string): Row {
	const st = requestStatus(r);
	const status: Cell = { text: STATUS_LABEL[st] + (st === "partial" && isOverdue(r) ? " (overdue)" : ""), color: st === "overdue" || isOverdue(r) ? "alert" : undefined };
	const scope = [r.type, r.scopeFrom || r.scopeTo ? `${formatShortDate(r.scopeFrom) || "?"} to ${r.scopeTo ? formatShortDate(r.scopeTo) : "present"}` : ""].filter((x) => x).join("; ");
	const next = isOpen(r) ? formatShortDate(dueDate(r)) : "";
	return [
		{ text: r.provider, bold: true },
		scope,
		formatShortDate(r.requested),
		status,
		formatShortDate(r.received),
		next,
		String(r.followups.length || ""),
		m(r.cost),
	];
}

function totalsRow(label: string, t: SpecialsTotals, m: (n: number | null) => string): Row {
	return ["", `${label} (${t.count})`, "", m(t.billed), m(t.planPaid + t.patientPaid), m(t.adjusted), m(t.balance)];
}

function includedDocs(c: CaseData): { attachment: Attachment; label: string }[] {
	const out: { attachment: Attachment; label: string }[] = [];
	for (const r of c.requests) for (const a of r.attachments) if (a.include) out.push({ attachment: a, label: `${r.provider} - ${a.kind}` });
	const encs = [...c.encounters].sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
	for (const e of encs) for (const a of e.attachments) if (a.include) out.push({ attachment: a, label: `${formatShortDate(e.date)} ${e.provider} - ${a.kind}` });
	return out;
}

const hasReceipt = (list: Attachment[]) => list.some((a) => a.kind === "Receipt" || a.kind === "Invoice");

export async function buildCaseReport(app: App, settings: MvaSettings, c: CaseData, opts: ReportOptions): Promise<{ bytes: Uint8Array; problems: string[] }> {
	const info = caseInfo(app, c);
	const m = money(settings);
	const w = await PdfWriter.create(settings.pageSize, `${info.client} - ${opts.title} - ${moment().format("MM/DD/YYYY")}`);
	const has = (k: SectionKey) => opts.sections.includes(k);
	header(w, settings, info, opts.title, opts.privileged);

	if (opts.notes.trim()) {
		w.heading("Notes for the attorney");
		w.text(opts.notes.trim(), { gap: 4 });
	}

	const encs = [...c.encounters].sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
	const t = totalsByRelatedness(encs);
	const partial = c.requests.filter((r) => r.state === "partial");
	const overdue = c.requests.filter((r) => isOverdue(r));
	const gapRows = encs.filter((e) => e.related !== "no" && gaps(e).length > 0);

	if (has("summary")) {
		w.heading("Summary");
		const lines = [
			`${c.requests.length} records request${c.requests.length === 1 ? "" : "s"}: ${c.requests.filter((r) => r.state === "complete").length} complete, ${partial.length} partial, ${c.requests.filter((r) => r.state === "sent").length} waiting.`,
			overdue.length ? `${overdue.length} overdue: ${overdue.map((r) => r.provider).join(", ")}.` : "No requests overdue.",
			`${encs.length} encounter${encs.length === 1 ? "" : "s"} logged. Related charges billed ${m(t.yes.billed)}, balance ${m(t.yes.balance)}.`,
		];
		if (t.unknown.count) lines.push(`${t.unknown.count} encounter${t.unknown.count === 1 ? "" : "s"} with relatedness not yet decided, billed ${m(t.unknown.billed)}.`);
		if (t.no.count) lines.push(`${t.no.count} encounter${t.no.count === 1 ? "" : "s"} excluded as not related, billed ${m(t.no.billed)}.`);
		const liens = encs.filter((e) => e.lienHolder || e.lienAmount !== null);
		if (liens.length) lines.push(`Liens: ${liens.map((e) => `${e.lienHolder || "unnamed"}${e.lienAmount !== null ? ` ${m(e.lienAmount)}` : ""}`).join("; ")}.`);
		const coll = encs.filter((e) => e.collections);
		if (coll.length) lines.push(`In collections: ${coll.map((e) => `${e.provider} (${e.collections})`).join("; ")}.`);
		lines.push(gapRows.length ? `${gapRows.length} documentation gap${gapRows.length === 1 ? "" : "s"} (bill without records, or records without a bill).` : "No documentation gaps.");
		w.bullets(lines);
	}

	if (has("requests")) {
		w.heading("Records request log");
		if (c.requests.length === 0) w.text("No requests logged.", { color: "muted" });
		else {
			const rows = [...c.requests].sort((a, b) => (a.requested || "").localeCompare(b.requested || ""));
			w.table(
				[
					{ header: "Provider", width: 2.2 },
					{ header: "Records / scope", width: 2.4 },
					{ header: "Sent", width: 1.1 },
					{ header: "Status", width: 1.2 },
					{ header: "Received", width: 1.1 },
					{ header: "Next due", width: 1.1 },
					{ header: "F/U", width: 0.5, align: "right" },
					{ header: "Fee", width: 0.9, align: "right" },
				],
				rows.map((r) => requestRow(r, m))
			);
		}
	}

	if (has("missing")) {
		w.heading("Still missing");
		if (partial.length === 0) w.text("Nothing outstanding from partial productions.", { color: "muted" });
		for (const r of partial) {
			w.text(`${r.provider} (received ${formatShortDate(r.received)}, follow up ${formatShortDate(r.followup)})`, { bold: true });
			w.bullets(r.missing, "alert");
			w.space(4);
		}
	}

	if (has("specials")) {
		w.heading("Medical specials");
		if (encs.length === 0) w.text("No encounters logged.", { color: "muted" });
		else {
			const rel = (e: Encounter): Cell => ({ text: e.related === "yes" ? "Related" : e.related === "no" ? "Not related" : "Unknown", color: e.related === "no" ? "muted" : undefined });
			const rows: Row[] = encs.map((e) => [
				formatShortDate(e.date),
				{ text: [e.provider, e.service].filter((x) => x).join(" - "), bold: false },
				rel(e),
				m(e.billed),
				e.planPaid !== null || e.patientPaid !== null ? m(paid(e)) : "",
				m(e.adjusted),
				e.billed === null ? "" : m(balance(e)),
			]);
			const foot: Row[] = [totalsRow("Related", t.yes, m)];
			if (t.unknown.count) foot.push(totalsRow("Unknown", t.unknown, m));
			if (t.no.count) foot.push(totalsRow("Excluded", t.no, m));
			w.table(
				[
					{ header: "Date", width: 1.1 },
					{ header: "Provider / service", width: 3.4 },
					{ header: "Related", width: 1.1 },
					{ header: "Billed", width: 1.1, align: "right" },
					{ header: "Paid", width: 1.1, align: "right" },
					{ header: "Adjusted", width: 1.1, align: "right" },
					{ header: "Balance", width: 1.1, align: "right" },
				],
				rows,
				foot
			);
			const reasons = encs.filter((e) => e.relatedReason);
			if (reasons.length) {
				w.text("Relatedness notes", { bold: true });
				w.bullets(reasons.map((e) => `${formatShortDate(e.date)} ${e.provider}: ${e.relatedReason}`));
			}
		}
	}

	if (has("gaps")) {
		w.heading("Documentation gaps");
		if (gapRows.length === 0) w.text("None. Every related encounter has both records and a bill on file.", { color: "muted" });
		else w.bullets(gapRows.map((e) => `${formatShortDate(e.date) || "No date"} ${e.provider}${e.service ? ` (${e.service})` : ""}: ${gaps(e).map((g) => GAP_LABEL[g]).join(", ")}`), "alert");
	}

	if (has("fees")) {
		w.heading("Fees and receipts");
		const feeRows: Row[] = c.requests
			.filter((r) => r.cost !== null || hasReceipt(r.attachments))
			.map((r) => [`Records fee - ${r.provider}`, formatShortDate(r.received || r.requested), m(r.cost), hasReceipt(r.attachments) ? "Yes" : { text: "No", color: "alert" }]);
		const cashRows: Row[] = encs
			.filter((e) => e.patientPaid !== null || hasReceipt(e.attachments))
			.map((e) => [`Patient paid - ${e.provider}`, formatShortDate(e.date), m(e.patientPaid), hasReceipt(e.attachments) ? "Yes" : { text: "No", color: "alert" }]);
		if (feeRows.length + cashRows.length === 0) w.text("No fees or patient payments logged.", { color: "muted" });
		else {
			const sum = (list: (number | null)[]) => list.reduce<number>((s, n) => s + (n ?? 0), 0);
			w.table(
				[
					{ header: "Item", width: 4 },
					{ header: "Date", width: 1.2 },
					{ header: "Amount", width: 1.2, align: "right" },
					{ header: "Receipt on file", width: 1.4 },
				],
				[...feeRows, ...cashRows],
				[["Total", "", m(sum(c.requests.map((r) => r.cost)) + sum(encs.map((e) => e.patientPaid))), ""]]
			);
		}
	}

	const docs = includedDocs(c);
	if (has("documents")) {
		w.heading("Index of documents on file");
		const all: { a: Attachment; owner: string }[] = [];
		for (const r of c.requests) for (const a of r.attachments) all.push({ a, owner: r.provider });
		for (const e of encs) for (const a of e.attachments) all.push({ a, owner: `${formatShortDate(e.date)} ${e.provider}` });
		if (all.length === 0) w.text("No documents attached.", { color: "muted" });
		else
			w.table(
				[
					{ header: "Document", width: 3.2 },
					{ header: "Type", width: 1.6 },
					{ header: "For", width: 2.6 },
					{ header: "In packet", width: 1 },
				],
				all.map(({ a, owner }): Row => [
					fileName(a.file),
					a.kind,
					owner,
					!app.vault.getAbstractFileByPath(a.file) ? { text: "File missing", color: "alert" } : a.include ? "Yes" : "No",
				])
			);
	}

	w.finishFooters();
	let problems: string[] = [];
	if (opts.appendDocuments && docs.length) problems = await w.appendAttachments(app, docs);
	return { bytes: await w.save(), problems };
}

export async function buildRequestPacket(app: App, settings: MvaSettings, c: CaseData, r: RecordRequest): Promise<{ bytes: Uint8Array; problems: string[] }> {
	const info = caseInfo(app, c);
	const w = await PdfWriter.create(settings.pageSize, `${info.client} - records request - ${r.provider}`);
	if (settings.firmName) w.text(settings.firmName.toUpperCase(), { size: 9, bold: true, color: "muted" });
	w.text("Records Request", { size: 18, bold: true, gap: 4 });
	w.keyValues([
		["To", r.provider],
		["Patient / client", info.client],
		["Date of incident", info.doi ? formatShortDate(info.doi) : ""],
		["Date", formatDate(r.requested) || formatDate(today())],
		["Records requested", r.type],
		["Date range", r.scopeFrom || r.scopeTo ? `${formatShortDate(r.scopeFrom) || "?"} to ${r.scopeTo ? formatShortDate(r.scopeTo) : "present"}` : ""],
		["Including", r.categories],
		["Return records via", r.delivery],
		["Please produce by", r.deadline ? formatDate(r.deadline) : ""],
		["Prepared by", settings.preparedBy],
	]);
	w.rule();
	const docs = r.attachments.filter((a) => a.include);
	w.heading("Enclosed");
	const lines = docs.map((a) => `${a.kind}: ${fileName(a.file)}`);
	for (const e of r.enclosures) if (!docs.some((a) => a.kind.toLowerCase().startsWith(e.toLowerCase().slice(0, 8)))) lines.push(`${e} (not attached in the plugin)`);
	w.bullets(lines.length ? lines : ["Nothing marked for the packet."]);
	if (r.missing.length) {
		w.heading("Items still outstanding from the prior production");
		w.bullets(r.missing);
	}
	w.finishFooters();
	const problems = await w.appendAttachments(app, docs.map((a) => ({ attachment: a, label: a.kind })));
	return { bytes: await w.save(), problems };
}

/** Saves a generated PDF under the case's files folder and opens it in a new tab. */
export async function saveAndOpen(app: App, settings: MvaSettings, caseFile: TFile, title: string, built: { bytes: Uint8Array; problems: string[] }): Promise<void> {
	const folder = `${caseFolder(settings, caseFile)}/Reports`;
	await ensureFolder(app, folder);
	const safe = title.replace(/[\\/:*?"<>|#^[\]]/g, "-");
	const path = freePath(app, folder, `${moment().format("YYYY-MM-DD")} ${safe}.pdf`);
	const bytes = built.bytes;
	const created = await app.vault.createBinary(path, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
	await app.workspace.getLeaf("tab").openFile(created);
	if (built.problems.length) new Notice(`Saved, with ${built.problems.length} problem${built.problems.length > 1 ? "s" : ""}:\n${built.problems.join("\n")}`, 12000);
	else new Notice(`Saved ${path}`);
}

/** Lists generated reports for a case, newest first. */
export function caseReports(app: App, settings: MvaSettings, caseFile: TFile): TFile[] {
	const folder = app.vault.getFolderByPath(`${caseFolder(settings, caseFile)}/Reports`);
	if (!folder) return [];
	return folder.children.filter((f): f is TFile => f instanceof TFile && f.extension === "pdf").sort((a, b) => b.name.localeCompare(a.name));
}

export class ReportModal extends Modal {
	private opts: ReportOptions;

	constructor(app: App, private caseName: string, private lastPrivileged: boolean, private onSubmit: (o: ReportOptions) => void) {
		super(app);
		const p = PRESETS["Case status update"];
		this.opts = { title: p.title, sections: [...p.sections], notes: "", appendDocuments: p.appendDocuments, privileged: lastPrivileged };
	}

	onOpen(): void {
		this.setTitle(`Report: ${this.caseName}`);
		this.modalEl.addClass("mva-modal");
		this.draw();
	}

	private draw(): void {
		const { contentEl } = this;
		contentEl.empty();
		const o = this.opts;
		new Setting(contentEl).setName("Report type").addDropdown((d) => {
			for (const name of Object.keys(PRESETS)) d.addOption(name, name);
			d.addOption("custom", "Custom");
			const current = Object.entries(PRESETS).find(([, p]) => p.title === o.title)?.[0] ?? "custom";
			d.setValue(current).onChange((v) => {
				const p = PRESETS[v];
				if (p) {
					o.title = p.title;
					o.sections = [...p.sections];
					o.appendDocuments = p.appendDocuments;
				}
				this.draw();
			});
		});
		new Setting(contentEl).setName("Title").addText((t) => t.setValue(o.title).onChange((v) => (o.title = v.trim() || "Case Report")));

		const sec = new Setting(contentEl).setName("Sections");
		sec.settingEl.addClass("mva-checklist-setting");
		const box = sec.controlEl.createDiv({ cls: "mva-checklist" });
		for (const key of Object.keys(SECTION_LABEL) as SectionKey[]) {
			const label = box.createEl("label", { cls: "mva-check" });
			const input = label.createEl("input", { type: "checkbox" });
			input.checked = o.sections.includes(key);
			input.addEventListener("change", () => {
				o.sections = (Object.keys(SECTION_LABEL) as SectionKey[]).filter((k) => (k === key ? input.checked : o.sections.includes(k)));
			});
			label.appendText(SECTION_LABEL[key]);
		}

		new Setting(contentEl)
			.setName("Notes for the attorney")
			.setDesc("Printed at the top. Recommendations, open questions, next steps.")
			.addTextArea((t) => {
				t.inputEl.rows = 5;
				t.setValue(o.notes).onChange((v) => (o.notes = v));
			});
		new Setting(contentEl)
			.setName("Append documents")
			.setDesc("Add every attachment marked for packets after the report, in date order.")
			.addToggle((t) => t.setValue(o.appendDocuments).onChange((v) => (o.appendDocuments = v)));
		new Setting(contentEl)
			.setName("Mark privileged / attorney work product")
			.addToggle((t) => t.setValue(o.privileged).onChange((v) => (o.privileged = v)));

		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText("Build PDF")
					.setCta()
					.onClick(() => {
						if (o.sections.length === 0 && !o.notes.trim()) {
							new Notice("Pick at least one section.");
							return;
						}
						this.onSubmit(o);
						this.close();
					})
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
