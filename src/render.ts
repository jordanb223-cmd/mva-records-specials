import { MarkdownPostProcessorContext, setIcon, TFile } from "obsidian";
import type MvaPlugin from "./main";
import {
	balance,
	formatDate,
	formatMoney,
	formatShortDate,
	isOverdue,
	GAP_LABEL,
	gaps,
	isOpen,
	paid,
	parseEncounters,
	parseRequests,
	requestStatus,
	SpecialsTotals,
	STATUS_LABEL,
	totalsByRelatedness,
} from "./data";
import { attachmentLinks, caseFolder } from "./attachments";
import { EncounterModal, ReceiveModal, RequestModal } from "./modals";
import { Encounter, RecordRequest, REQUESTS_LANG, SPECIALS_LANG } from "./types";

export function iconButton(parent: HTMLElement, icon: string, label: string, onClick: () => void): HTMLElement {
	const btn = parent.createEl("button", { cls: "clickable-icon mva-icon-btn", attr: { "aria-label": label } });
	setIcon(btn, icon);
	btn.addEventListener("click", (e) => {
		e.preventDefault();
		e.stopPropagation();
		onClick();
	});
	return btn;
}

function renderError(el: HTMLElement, err: unknown): void {
	const box = el.createDiv({ cls: "mva-error" });
	box.createEl("strong", { text: "Could not read this block. " });
	box.appendText(err instanceof Error ? err.message : String(err));
	box.createDiv({ text: "Nothing has been changed. Fix the YAML in source mode to restore the table." });
}

function context(plugin: MvaPlugin, el: HTMLElement, ctx: MarkdownPostProcessorContext): { file: TFile; line: () => number | undefined } | null {
	const file = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
	if (!(file instanceof TFile)) return null;
	// Section info is read lazily: it reflects the block's position at the moment of the click.
	return { file, line: () => ctx.getSectionInfo(el)?.lineStart };
}

export function scopeText(r: RecordRequest): string {
	if (!r.scopeFrom && !r.scopeTo) return "";
	return `${formatDate(r.scopeFrom) || "—"} to ${r.scopeTo ? formatDate(r.scopeTo) : "present"}`;
}

export function renderRequests(plugin: MvaPlugin, source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
	let items: RecordRequest[];
	try {
		items = parseRequests(source);
	} catch (err) {
		renderError(el, err);
		return;
	}
	const where = context(plugin, el, ctx);
	const currency = plugin.settings.currency;
	const wrap = el.createDiv({ cls: "mva-block" });

	const head = wrap.createDiv({ cls: "mva-block-head" });
	head.createSpan({ cls: "mva-block-title", text: "Records requests" });
	const open = items.filter(isOpen).length;
	const overdue = items.filter((r) => isOverdue(r)).length;
	const partial = items.filter((r) => r.state === "partial").length;
	const bits = [`${items.length} total`, `${open} open`];
	if (overdue) bits.push(`${overdue} overdue`);
	if (partial) bits.push(`${partial} partial`);
	head.createSpan({ cls: "mva-block-sub", text: bits.join(" · ") });

	const save = (mutate: (list: RecordRequest[]) => RecordRequest[]) => {
		if (!where) return;
		void plugin.mutateRequests(where.file, mutate, where.line());
	};
	const replace = (updated: RecordRequest) => save((list) => list.map((x) => (x.id === updated.id ? updated : x)));
	const folder = where ? caseFolder(plugin.settings, where.file) : null;

	if (items.length > 0) {
		const list = wrap.createDiv({ cls: "mva-dash-list" });
		for (const r of items) {
			const status = requestStatus(r);
			const card = list.createDiv({ cls: `mva-card mva-row-${status}` });
			const top = card.createDiv({ cls: "mva-card-top" });
			top.createSpan({ cls: `mva-pill mva-pill-${status}`, text: STATUS_LABEL[status] });
			if (status === "partial" && isOverdue(r)) top.createSpan({ cls: "mva-pill mva-pill-overdue", text: "Overdue" });
			top.createSpan({ cls: "mva-card-provider", text: r.provider });
			const actions = top.createDiv({ cls: "mva-card-icons" });
			if (isOpen(r)) {
				iconButton(actions, "phone-outgoing", "Log follow-up", () => replace(plugin.logFollowUp(r)));
				iconButton(actions, "inbox", "Record production received", () => new ReceiveModal(plugin.app, r, plugin.settings.followUpDays, replace, folder).open());
			}
			if (where) iconButton(actions, "printer", "Build request packet (PDF)", () => void plugin.buildPacket(where.file, r.id));
			iconButton(actions, "pencil", "Edit", () =>
				new RequestModal(plugin.app, plugin.settings, r, replace, () => save((list) => list.filter((x) => x.id !== r.id)), undefined, folder).open()
			);

			const line = (parts: (string | false | null | undefined)[]) => {
				const text = parts.filter((p) => p).join(" · ");
				if (text) card.createDiv({ cls: "mva-card-meta", text });
			};
			line([r.type, scopeText(r)]);
			line([r.categories]);
			line([
				r.enclosures.length > 0 && `Sent with ${r.enclosures.join(", ")}`,
				r.method && `via ${r.method}`,
				r.delivery && `return by ${r.delivery}`,
			]);
			line([
				`Sent ${formatDate(r.requested) || "—"}`,
				r.received && `Received ${formatDate(r.received)}`,
				isOpen(r) && r.followup && `Follow up ${formatDate(r.followup)}`,
				r.state === "sent" && r.deadline && `Deadline ${formatDate(r.deadline)}`,
				r.followups.length > 0 && `${r.followups.length} follow-up${r.followups.length > 1 ? "s" : ""} logged`,
				r.cost !== null && `Fee ${formatMoney(r.cost, currency)}`,
			]);
			if (r.missing.length) {
				card.createDiv({ cls: "mva-card-meta mva-strong", text: "Still missing:" });
				const miss = card.createEl("ul", { cls: "mva-missing" });
				for (const m of r.missing) miss.createEl("li", { text: m });
			}
			if (r.notes) card.createDiv({ cls: "mva-card-meta mva-italic", text: r.notes });
			attachmentLinks(plugin.app, card, r.attachments, ctx.sourcePath);
		}
	}

	if (where) {
		const bar = wrap.createDiv({ cls: "mva-block-buttons" });
		const add = bar.createEl("button", { cls: "mva-add", text: "Add request" });
		add.addEventListener("click", () =>
			new RequestModal(plugin.app, plugin.settings, null, (created) => save((list) => [...list, created]), undefined, plugin.caseDefaults(where.file), folder).open()
		);
		const report = bar.createEl("button", { cls: "mva-add", text: "Case report…" });
		report.addEventListener("click", () => plugin.openReportModal(where.file));
	}
}

function totalRow(tfoot: HTMLElement, label: string, t: SpecialsTotals, money: (n: number) => string, cls = ""): void {
	const tr = tfoot.createEl("tr", { cls });
	const name = tr.createEl("td", { attr: { colspan: "2" } });
	name.createDiv({ text: `${label} (${t.count})` });
	if (t.liens) name.createDiv({ cls: "mva-note", text: `Liens ${money(t.liens)}` });
	tr.createEl("td", { cls: "mva-num", text: money(t.billed) });
	const p = tr.createEl("td", { cls: "mva-num" });
	p.createDiv({ text: money(t.planPaid + t.patientPaid) });
	if (t.adjusted) p.createDiv({ cls: "mva-note", text: `adj. ${money(t.adjusted)}` });
	tr.createEl("td", { cls: "mva-num", text: money(t.balance) });
	tr.createEl("td");
}

export function renderSpecials(plugin: MvaPlugin, source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
	let items: Encounter[];
	try {
		items = parseEncounters(source);
	} catch (err) {
		renderError(el, err);
		return;
	}
	const where = context(plugin, el, ctx);
	const currency = plugin.settings.currency;
	const money = (n: number | null) => formatMoney(n, currency);
	const wrap = el.createDiv({ cls: "mva-block" });
	items = [...items].sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));

	const head = wrap.createDiv({ cls: "mva-block-head" });
	head.createSpan({ cls: "mva-block-title", text: "Medical specials" });
	const noRecords = items.filter((e) => gaps(e).includes("no-records")).length;
	const noBill = items.filter((e) => gaps(e).includes("no-bill")).length;
	const unknown = items.filter((e) => e.related === "unknown").length;
	const bits = [`${items.length} encounter${items.length === 1 ? "" : "s"}`];
	if (noRecords) bits.push(`${noRecords} billed without records`);
	if (noBill) bits.push(`${noBill} without a bill`);
	if (unknown) bits.push(`${unknown} relatedness unknown`);
	head.createSpan({ cls: "mva-block-sub", text: bits.join(" · ") });

	const save = (mutate: (list: Encounter[]) => Encounter[]) => {
		if (!where) return;
		void plugin.mutateSpecials(where.file, mutate, where.line());
	};
	const folder = where ? caseFolder(plugin.settings, where.file) : null;

	if (items.length > 0) {
		const scroller = wrap.createDiv({ cls: "mva-table-wrap" });
		const table = scroller.createEl("table", { cls: "mva-table" });
		const hr = table.createEl("thead").createEl("tr");
		for (const h of ["Date", "Encounter", "Billed", "Paid", "Balance", ""]) hr.createEl("th", { text: h });
		const tbody = table.createEl("tbody");
		for (const e of items) {
			const tr = tbody.createEl("tr", { cls: e.related === "no" ? "mva-row-excluded" : "" });
			tr.createEl("td", { text: formatShortDate(e.date), cls: "mva-nowrap" });
			const enc = tr.createEl("td");
			enc.createDiv({ cls: "mva-strong", text: e.provider });
			if (e.service) enc.createDiv({ cls: "mva-note", text: e.service });
			const tags = enc.createDiv({ cls: "mva-tags" });
			tags.createSpan({ cls: `mva-pill mva-rel-${e.related}`, text: e.related === "yes" ? "Related" : e.related === "no" ? "Not related" : "Relatedness unknown" });
			for (const g of gaps(e)) tags.createSpan({ cls: "mva-pill mva-pill-overdue", text: GAP_LABEL[g] });
			if (!e.records && !e.bill) tags.createSpan({ cls: "mva-pill", text: "No records or bill yet" });
			if (e.relatedReason) enc.createDiv({ cls: "mva-note", text: e.relatedReason });
			const lienBits = [
				e.lienHolder && `Lien: ${e.lienHolder}${e.lienAmount !== null ? ` ${money(e.lienAmount)}` : ""}`,
				!e.lienHolder && e.lienAmount !== null && `Lien ${money(e.lienAmount)}`,
				e.collections && `Collections: ${e.collections}`,
			].filter((x) => x);
			if (lienBits.length) enc.createDiv({ cls: "mva-note", text: lienBits.join(" · ") });
			if (e.notes) enc.createDiv({ cls: "mva-note mva-italic", text: e.notes });
			attachmentLinks(plugin.app, enc, e.attachments, ctx.sourcePath);

			tr.createEl("td", { cls: "mva-num", text: money(e.billed) });
			const paidCell = tr.createEl("td", { cls: "mva-num" });
			if (e.planPaid !== null || e.patientPaid !== null) paidCell.createDiv({ text: money(paid(e)) });
			if (e.planPaid !== null && e.patientPaid !== null) paidCell.createDiv({ cls: "mva-note", text: `plan ${money(e.planPaid)}` });
			if (e.planPaid !== null && e.patientPaid !== null) paidCell.createDiv({ cls: "mva-note", text: `patient ${money(e.patientPaid)}` });
			if (e.planPaid === null && e.patientPaid !== null) paidCell.createDiv({ cls: "mva-note", text: "patient" });
			if (e.adjusted !== null) paidCell.createDiv({ cls: "mva-note", text: `adj. ${money(e.adjusted)}` });
			tr.createEl("td", { cls: "mva-num mva-strong", text: e.billed === null ? "" : money(balance(e)) });

			const actions = tr.createEl("td", { cls: "mva-actions" });
			iconButton(actions, "pencil", "Edit", () =>
				new EncounterModal(
					plugin.app,
					e,
					(updated) => save((list) => list.map((x) => (x.id === e.id ? updated : x))),
					() => save((list) => list.filter((x) => x.id !== e.id)),
					folder
				).open()
			);
		}
		const t = totalsByRelatedness(items);
		const tfoot = table.createEl("tfoot");
		const m = (n: number) => formatMoney(n, currency);
		totalRow(tfoot, "Related", t.yes, m, "mva-total-main");
		if (t.unknown.count) totalRow(tfoot, "Relatedness unknown", t.unknown, m);
		if (t.no.count) totalRow(tfoot, "Not related (excluded)", t.no, m, "mva-row-excluded");
	}

	if (where) {
		const add = wrap.createEl("button", { cls: "mva-add", text: "Add encounter" });
		add.addEventListener("click", () => new EncounterModal(plugin.app, null, (created) => save((list) => [...list, created]), undefined, folder).open());
	}
}

export function registerBlocks(plugin: MvaPlugin): void {
	plugin.registerMarkdownCodeBlockProcessor(REQUESTS_LANG, (source, el, ctx) => renderRequests(plugin, source, el, ctx));
	plugin.registerMarkdownCodeBlockProcessor(SPECIALS_LANG, (source, el, ctx) => renderSpecials(plugin, source, el, ctx));
}
