import { moment, parseYaml, stringifyYaml } from "obsidian";
import { Attachment, Encounter, ReceiptState, RecordRequest, Relatedness, RequestStatus } from "./types";

export function newId(): string {
	return Math.random().toString(36).slice(2, 8);
}

export function today(): string {
	return moment().format("YYYY-MM-DD");
}

export function addDays(date: string, days: number): string {
	const base = date ? moment(date, "YYYY-MM-DD") : moment();
	return base.add(days, "days").format("YYYY-MM-DD");
}

function str(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (value instanceof Date) return moment(value).utc().format("YYYY-MM-DD");
	if (typeof value === "string") return value.trim();
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	// Nested maps or lists where a plain value belongs are dropped rather than printed as "[object Object]".
	return "";
}

function num(value: unknown): number | null {
	if (value === null || value === undefined || value === "") return null;
	if (typeof value === "number") return isFinite(value) ? value : null;
	if (typeof value !== "string") return null;
	const n = parseFloat(value.replace(/[$,\s]/g, ""));
	return isFinite(n) ? n : null;
}

function strList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.map(str).filter((s) => s.length > 0);
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** Parses the YAML list inside a code block. Throws on malformed YAML so callers never overwrite data they could not read. */
function parseList(source: string): Record<string, unknown>[] {
	if (!source.trim()) return [];
	const parsed: unknown = parseYaml(source);
	if (parsed === null || parsed === undefined) return [];
	if (!Array.isArray(parsed)) throw new Error("Expected a list of entries (each starting with \"- \").");
	return parsed.map(asRecord);
}

function bool(value: unknown): boolean {
	if (typeof value === "boolean") return value;
	const s = str(value).toLowerCase();
	return s === "true" || s === "yes" || s === "y";
}

function attachments(value: unknown): Attachment[] {
	if (!Array.isArray(value)) return [];
	const out: Attachment[] = [];
	for (const v of value) {
		if (typeof v === "string") {
			if (v.trim()) out.push({ file: v.trim(), kind: "Other", include: true });
			continue;
		}
		const r = asRecord(v);
		const file = str(r.file);
		if (!file) continue;
		out.push({ file, kind: str(r.kind) || "Other", include: r.include === undefined ? true : bool(r.include) });
	}
	return out;
}

function receiptState(value: unknown, received: string): ReceiptState {
	const s = str(value).toLowerCase();
	if (s === "partial" || s === "complete" || s === "sent") return s;
	// Entries written before the state field existed: a received date meant complete.
	return received ? "complete" : "sent";
}

function relatedness(value: unknown): Relatedness {
	if (value === true) return "yes";
	if (value === false) return "no";
	const s = str(value).toLowerCase();
	return s === "yes" || s === "no" ? s : "unknown";
}

// Entries typed by hand may lack an id; they get a positional one so a re-read finds the same row.
export function parseRequests(source: string): RecordRequest[] {
	return parseList(source).map((r, i) => {
		const received = str(r.received);
		return {
			id: str(r.id) || `row${i + 1}`,
			provider: str(r.provider),
			type: str(r.type),
			method: str(r.method),
			delivery: str(r.delivery),
			requested: str(r.requested),
			followup: str(r.followup),
			deadline: str(r.deadline),
			scopeFrom: str(r.scope_from),
			scopeTo: str(r.scope_to),
			categories: str(r.categories),
			enclosures: strList(r.enclosures),
			state: receiptState(r.state, received),
			received,
			missing: strList(r.missing),
			cost: num(r.cost),
			followups: strList(r.followups),
			attachments: attachments(r.attachments),
			notes: str(r.notes),
		};
	});
}

export function parseEncounters(source: string): Encounter[] {
	return parseList(source).map((r, i) => ({
		id: str(r.id) || `row${i + 1}`,
		// "from" and "paid" and "lien" are the v0.1 field names.
		date: str(r.date) || str(r.from),
		provider: str(r.provider),
		service: str(r.service),
		related: relatedness(r.related),
		relatedReason: str(r.related_reason),
		records: bool(r.records),
		bill: bool(r.bill),
		billed: num(r.billed),
		planPaid: num(r.plan_paid ?? r.paid),
		patientPaid: num(r.patient_paid),
		adjusted: num(r.adjusted),
		lienHolder: str(r.lien_holder ?? r.lien),
		lienAmount: num(r.lien_amount),
		collections: str(r.collections),
		attachments: attachments(r.attachments),
		notes: str(r.notes),
	}));
}

/** Field names on disk use snake_case so the YAML reads naturally. */
export function requestToYaml(r: RecordRequest): object {
	return {
		id: r.id,
		provider: r.provider,
		type: r.type,
		method: r.method,
		delivery: r.delivery,
		requested: r.requested,
		followup: r.followup,
		deadline: r.deadline,
		scope_from: r.scopeFrom,
		scope_to: r.scopeTo,
		categories: r.categories,
		enclosures: r.enclosures,
		state: r.state,
		received: r.received,
		missing: r.missing,
		cost: r.cost,
		followups: r.followups,
		attachments: r.attachments.map((a) => ({ ...a })),
		notes: r.notes,
	};
}

export function encounterToYaml(e: Encounter): object {
	return {
		id: e.id,
		date: e.date,
		provider: e.provider,
		service: e.service,
		related: e.related,
		related_reason: e.relatedReason,
		records: e.records,
		bill: e.bill,
		billed: e.billed,
		plan_paid: e.planPaid,
		patient_paid: e.patientPaid,
		adjusted: e.adjusted,
		lien_holder: e.lienHolder,
		lien_amount: e.lienAmount,
		collections: e.collections,
		attachments: e.attachments.map((a) => ({ ...a })),
		notes: e.notes,
	};
}

/** Drops empty fields so the note stays readable. */
function compact(entry: object): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(entry)) {
		if (value === null || value === undefined || value === "") continue;
		if (Array.isArray(value) && value.length === 0) continue;
		out[key] = value;
	}
	return out;
}

export function serializeList(entries: object[]): string {
	if (entries.length === 0) return "";
	return stringifyYaml(entries.map(compact)).trimEnd();
}

/** The date that makes an open request overdue. After a partial production only your follow-up counts; the letter's deadline has been answered. */
export function dueDate(r: RecordRequest): string {
	if (r.state === "complete") return "";
	if (r.state === "partial") return r.followup;
	return [r.followup, r.deadline].filter((d) => d).sort()[0] ?? "";
}

export function isOverdue(r: RecordRequest, now = today()): boolean {
	const due = dueDate(r);
	return !!due && due < now;
}

export function requestStatus(r: RecordRequest, now = today()): RequestStatus {
	if (r.state === "complete") return "complete";
	if (r.state === "partial") return "partial";
	const due = dueDate(r);
	if (!due) return "pending";
	if (due < now) return "overdue";
	if (due === now) return "due-today";
	return "pending";
}

export const STATUS_LABEL: Record<RequestStatus, string> = {
	complete: "Complete",
	partial: "Partial",
	overdue: "Overdue",
	"due-today": "Due today",
	pending: "Pending",
};

export function isOpen(r: RecordRequest): boolean {
	return r.state !== "complete";
}

export function paid(e: Encounter): number {
	return (e.planPaid ?? 0) + (e.patientPaid ?? 0);
}

export function balance(e: Encounter): number {
	return (e.billed ?? 0) - paid(e) - (e.adjusted ?? 0);
}

export type GapKind = "no-records" | "no-bill";

/** A documentation gap: billed with no chart notes, or treated with no bill in hand. */
export function gaps(e: Encounter): GapKind[] {
	const out: GapKind[] = [];
	if (e.bill && !e.records) out.push("no-records");
	if (e.records && !e.bill) out.push("no-bill");
	return out;
}

export const GAP_LABEL: Record<GapKind, string> = {
	"no-records": "Billed, no records",
	"no-bill": "Records, no bill",
};

export interface SpecialsTotals {
	count: number;
	billed: number;
	planPaid: number;
	patientPaid: number;
	adjusted: number;
	balance: number;
	liens: number;
}

export function totals(entries: Encounter[]): SpecialsTotals {
	const t = { count: 0, billed: 0, planPaid: 0, patientPaid: 0, adjusted: 0, balance: 0, liens: 0 };
	for (const e of entries) {
		t.count++;
		t.billed += e.billed ?? 0;
		t.planPaid += e.planPaid ?? 0;
		t.patientPaid += e.patientPaid ?? 0;
		t.adjusted += e.adjusted ?? 0;
		t.balance += balance(e);
		t.liens += e.lienAmount ?? 0;
	}
	return t;
}

/** Totals split by relatedness, so excluded charges stay visible instead of disappearing. */
export function totalsByRelatedness(entries: Encounter[]): Record<Relatedness, SpecialsTotals> {
	return {
		yes: totals(entries.filter((e) => e.related === "yes")),
		unknown: totals(entries.filter((e) => e.related === "unknown")),
		no: totals(entries.filter((e) => e.related === "no")),
	};
}

export function formatMoney(value: number | null, currency: string): string {
	if (value === null) return "";
	try {
		return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);
	} catch {
		return value.toFixed(2);
	}
}

export function formatDate(date: string): string {
	if (!date) return "";
	const m = moment(date, "YYYY-MM-DD", true);
	return m.isValid() ? m.format("MMM D, YYYY") : date;
}

export function formatShortDate(date: string): string {
	if (!date) return "";
	const m = moment(date, "YYYY-MM-DD", true);
	return m.isValid() ? m.format("MM/DD/YYYY") : date;
}

// ---------- Locating blocks inside a note ----------

export interface BlockLocation {
	/** Line of the opening fence. */
	start: number;
	/** Line of the closing fence. */
	end: number;
	body: string;
}

const FENCE = /^(\s*)(`{3,}|~{3,})\s*([\w-]+)?\s*$/;

export function findBlocks(text: string, lang: string): BlockLocation[] {
	const lines = text.split("\n");
	const found: BlockLocation[] = [];
	let i = 0;
	while (i < lines.length) {
		const open = FENCE.exec(lines[i]);
		if (!open) {
			i++;
			continue;
		}
		const fence = open[2];
		let j = i + 1;
		while (j < lines.length && !lines[j].trim().startsWith(fence)) j++;
		if (open[3] === lang) {
			found.push({ start: i, end: j, body: lines.slice(i + 1, j).join("\n") });
		}
		i = j + 1;
	}
	return found;
}

/**
 * Rewrites the body of one block. `atLine` picks the block whose opening fence is on that line;
 * without it the first block is used. If the note has no block of this kind, one is appended.
 */
export function replaceBlockBody(text: string, lang: string, newBody: string, atLine?: number, heading?: string): string {
	const blocks = findBlocks(text, lang);
	const target = atLine === undefined ? blocks[0] : blocks.find((b) => b.start === atLine);
	if (!target) {
		if (atLine !== undefined) throw new Error("The block moved while you were editing. Try again.");
		const sep = text.length === 0 || text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
		const head = heading ? `## ${heading}\n\n` : "";
		return `${text}${sep}${head}\`\`\`${lang}\n${newBody}${newBody ? "\n" : ""}\`\`\`\n`;
	}
	const lines = text.split("\n");
	const bodyLines = newBody ? newBody.split("\n") : [];
	lines.splice(target.start + 1, target.end - target.start - 1, ...bodyLines);
	return lines.join("\n");
}
