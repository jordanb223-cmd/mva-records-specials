import { debounce, ItemView, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import type MvaPlugin from "./main";
import { dueDate, formatDate, formatMoney, GAP_LABEL, gaps, isOpen, isOverdue, requestStatus, STATUS_LABEL, today, totalsByRelatedness } from "./data";
import { caseFolder } from "./attachments";
import { ReceiveModal } from "./modals";
import { caseReports } from "./reports";
import { scopeText } from "./render";
import { Encounter, RecordRequest } from "./types";

export const DASHBOARD_VIEW = "mva-dashboard";

export interface CaseData {
	file: TFile;
	name: string;
	requests: RecordRequest[];
	encounters: Encounter[];
	errors: number;
}

type Filter = "open" | "overdue" | "partial" | "all";

export class DashboardView extends ItemView {
	private filter: Filter = "open";
	private cases: CaseData[] = [];
	private refreshSoon = debounce(() => void this.refresh(), 750, true);

	constructor(leaf: WorkspaceLeaf, private plugin: MvaPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return DASHBOARD_VIEW;
	}

	getDisplayText(): string {
		return "Records dashboard";
	}

	getIcon(): string {
		return "folder-heart";
	}

	async onOpen(): Promise<void> {
		this.registerEvent(this.app.metadataCache.on("changed", () => this.refreshSoon()));
		this.registerEvent(this.app.vault.on("delete", () => this.refreshSoon()));
		this.registerEvent(this.app.vault.on("rename", () => this.refreshSoon()));
		await this.refresh();
	}

	async refresh(): Promise<void> {
		this.cases = await this.plugin.collectCases();
		this.draw();
	}

	private draw(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("mva-dashboard");

		const bar = root.createDiv({ cls: "mva-dash-bar" });
		for (const [key, label] of [
			["open", "Open"],
			["overdue", "Overdue"],
			["partial", "Partial"],
			["all", "All"],
		] as [Filter, string][]) {
			const b = bar.createEl("button", { text: label, cls: key === this.filter ? "mod-cta" : "" });
			b.addEventListener("click", () => {
				this.filter = key;
				this.draw();
			});
		}
		const refresh = bar.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Refresh" } });
		setIcon(refresh, "refresh-cw");
		refresh.addEventListener("click", () => void this.refresh());

		if (this.cases.length === 0) {
			root.createDiv({
				cls: "mva-empty",
				text: "No case notes found. Run \"Add records request\" or \"Add encounter\" from the command palette inside a case note to start tracking.",
			});
			return;
		}

		this.drawRequests(root);
		this.drawGaps(root);
		this.drawSpecials(root);

		const errs = this.cases.filter((c) => c.errors > 0);
		if (errs.length) {
			const warn = root.createDiv({ cls: "mva-error" });
			warn.createEl("strong", { text: "Some blocks could not be read: " });
			errs.forEach((c, i) => {
				if (i) warn.appendText(", ");
				this.link(warn, c);
			});
		}
	}

	private link(parent: HTMLElement, c: CaseData): void {
		const a = parent.createEl("a", { text: c.name, cls: "internal-link" });
		a.addEventListener("click", (e) => {
			e.preventDefault();
			void this.app.workspace.getLeaf(e.ctrlKey || e.metaKey).openFile(c.file);
		});
	}

	private drawRequests(root: HTMLElement): void {
		const now = today();
		const rows: { c: CaseData; r: RecordRequest }[] = [];
		for (const c of this.cases) {
			for (const r of c.requests) {
				const st = requestStatus(r, now);
				if (this.filter === "open" && !isOpen(r)) continue;
				if (this.filter === "overdue" && !isOverdue(r, now)) continue;
				if (this.filter === "partial" && st !== "partial") continue;
				rows.push({ c, r });
			}
		}
		// Open items first, soonest due date first; complete items after, newest first.
		const due = (r: RecordRequest) => dueDate(r) || "9999";
		rows.sort((a, b) => {
			if (isOpen(a.r) !== isOpen(b.r)) return isOpen(a.r) ? -1 : 1;
			if (!isOpen(a.r)) return b.r.received.localeCompare(a.r.received);
			return due(a.r).localeCompare(due(b.r));
		});

		root.createEl("h4", { text: `Records requests (${rows.length})` });
		if (rows.length === 0) {
			root.createDiv({ cls: "mva-empty", text: "No requests to show." });
			return;
		}
		const list = root.createDiv({ cls: "mva-dash-list" });
		for (const { c, r } of rows) {
			const st = requestStatus(r, now);
			const card = list.createDiv({ cls: `mva-card mva-row-${st}` });
			const top = card.createDiv({ cls: "mva-card-top" });
			top.createSpan({ cls: `mva-pill mva-pill-${st}`, text: STATUS_LABEL[st] });
			if (st === "partial" && isOverdue(r, now)) top.createSpan({ cls: "mva-pill mva-pill-overdue", text: "Overdue" });
			top.createSpan({ cls: "mva-card-provider", text: r.provider });
			const meta = card.createDiv({ cls: "mva-card-meta" });
			this.link(meta, c);
			for (const bit of [r.type, scopeText(r)]) if (bit) meta.appendText(` · ${bit}`);

			const dates = card.createDiv({ cls: "mva-card-meta" });
			dates.appendText(`Sent ${formatDate(r.requested) || "—"}`);
			if (r.received) dates.appendText(` · Received ${formatDate(r.received)}`);
			if (isOpen(r)) {
				if (r.followup) dates.appendText(` · Follow up ${formatDate(r.followup)}`);
				if (r.deadline && r.state === "sent") dates.appendText(` · Deadline ${formatDate(r.deadline)}`);
			}
			if (r.followups.length) dates.appendText(` · ${r.followups.length} follow-up${r.followups.length > 1 ? "s" : ""}`);

			if (r.missing.length) {
				const miss = card.createEl("ul", { cls: "mva-missing" });
				for (const m of r.missing) miss.createEl("li", { text: m });
			}

			if (isOpen(r)) {
				const actions = card.createDiv({ cls: "mva-card-actions" });
				const fu = actions.createEl("button", { text: "Log follow-up" });
				fu.addEventListener("click", () => void this.update(c, r.id, (x) => this.plugin.logFollowUp(x)));
				const rec = actions.createEl("button", { text: "Received…" });
				rec.addEventListener("click", () => new ReceiveModal(this.app, r, this.plugin.settings.followUpDays, (updated) => void this.update(c, r.id, () => updated), caseFolder(this.plugin.settings, c.file)).open());
			}
		}
	}

	private async update(c: CaseData, id: string, change: (r: RecordRequest) => RecordRequest): Promise<void> {
		await this.plugin.mutateRequestById(c.file, id, change);
		await this.refresh();
	}

	private drawGaps(root: HTMLElement): void {
		const rows: { c: CaseData; e: Encounter }[] = [];
		for (const c of this.cases) for (const e of c.encounters) if (e.related !== "no" && gaps(e).length) rows.push({ c, e });
		if (rows.length === 0) return;
		rows.sort((a, b) => a.c.name.localeCompare(b.c.name) || (a.e.date || "").localeCompare(b.e.date || ""));
		root.createEl("h4", { text: `Documentation gaps (${rows.length})` });
		const list = root.createDiv({ cls: "mva-dash-list" });
		for (const { c, e } of rows) {
			const card = list.createDiv({ cls: "mva-card" });
			const top = card.createDiv({ cls: "mva-card-top" });
			for (const g of gaps(e)) top.createSpan({ cls: "mva-pill mva-pill-overdue", text: GAP_LABEL[g] });
			top.createSpan({ cls: "mva-card-provider", text: e.provider });
			const meta = card.createDiv({ cls: "mva-card-meta" });
			this.link(meta, c);
			meta.appendText(` · ${formatDate(e.date) || "no date"}`);
			if (e.service) meta.appendText(` · ${e.service}`);
		}
	}

	/** One row per case: the attorney's way in to the latest report, or a fresh one. */
	private drawSpecials(root: HTMLElement): void {
		const cur = this.plugin.settings.currency;
		root.createEl("h4", { text: "Cases" });
		const wrap = root.createDiv({ cls: "mva-table-wrap" });
		const table = wrap.createEl("table", { cls: "mva-table" });
		const hr = table.createEl("thead").createEl("tr");
		for (const h of ["Case", "Open", "Related billed", "Balance", "Reports"]) hr.createEl("th", { text: h });
		const tbody = table.createEl("tbody");
		for (const c of this.cases) {
			const t = totalsByRelatedness(c.encounters);
			const tr = tbody.createEl("tr");
			const name = tr.createEl("td");
			this.link(name, c);
			if (t.unknown.count) name.createDiv({ cls: "mva-note", text: `${t.unknown.count} relatedness unknown` });
			tr.createEl("td", { cls: "mva-num", text: String(c.requests.filter(isOpen).length) });
			tr.createEl("td", { cls: "mva-num", text: c.encounters.length ? formatMoney(t.yes.billed, cur) : "" });
			tr.createEl("td", { cls: "mva-num", text: c.encounters.length ? formatMoney(t.yes.balance, cur) : "" });
			const rep = tr.createEl("td", { cls: "mva-nowrap" });
			const latest = caseReports(this.app, this.plugin.settings, c.file)[0];
			if (latest) {
				const a = rep.createEl("a", { text: latest.basename.slice(0, 10), attr: { "aria-label": `Open ${latest.basename}` } });
				a.addEventListener("click", (e) => {
					e.preventDefault();
					void this.app.workspace.getLeaf("tab").openFile(latest);
				});
			}
			const btn = rep.createEl("button", { cls: "clickable-icon mva-icon-btn", attr: { "aria-label": "Build a new report" } });
			setIcon(btn, "file-plus-2");
			btn.addEventListener("click", () => this.plugin.openReportModal(c.file));
		}
	}
}
