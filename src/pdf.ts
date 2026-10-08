import { App, TFile } from "obsidian";
import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from "pdf-lib";
import { fileName } from "./attachments";
import { Attachment } from "./types";

const SIZES = { letter: [612, 792] as [number, number], a4: [595.28, 841.89] as [number, number] };
const MARGIN = 54;
const INK = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.42, 0.42, 0.42);
const RULE = rgb(0.78, 0.78, 0.78);
const ALERT = rgb(0.7, 0.12, 0.12);

export interface Column {
	header: string;
	/** Share of the usable width; shares are normalised. */
	width: number;
	align?: "left" | "right";
}

export interface Cell {
	text: string;
	bold?: boolean;
	color?: "muted" | "alert";
}

export type Row = (string | Cell)[];

/** A small top-to-bottom layout engine over pdf-lib: wrapped text, headings, and tables that break across pages. */
export class PdfWriter {
	readonly doc: PDFDocument;
	private font!: PDFFont;
	private bold!: PDFFont;
	private page!: PDFPage;
	private y = 0;
	private readonly size: [number, number];
	private okChars = new Map<string, boolean>();

	private constructor(doc: PDFDocument, pageSize: "letter" | "a4", private footerText: string) {
		this.doc = doc;
		this.size = SIZES[pageSize];
	}

	static async create(pageSize: "letter" | "a4", footerText: string): Promise<PdfWriter> {
		const w = new PdfWriter(await PDFDocument.create(), pageSize, footerText);
		w.font = await w.doc.embedFont(StandardFonts.Helvetica);
		w.bold = await w.doc.embedFont(StandardFonts.HelveticaBold);
		w.newPage();
		return w;
	}

	get width(): number {
		return this.size[0] - MARGIN * 2;
	}

	newPage(): void {
		this.page = this.doc.addPage(this.size);
		this.y = this.size[1] - MARGIN;
	}

	private ensure(height: number): void {
		if (this.y - height < MARGIN + 18) this.newPage();
	}

	/** The standard PDF fonts only cover Latin-1-ish text; swap or drop anything they cannot draw. */
	clean(text: string): string {
		const swaps: Record<string, string> = { "✓": "Yes", "✗": "No", "→": "->", "≥": ">=", "≤": "<=", "‑": "-", " ": " ", "\t": "  " };
		let out = "";
		for (const ch of text) {
			if (ch === "\n") {
				out += ch;
				continue;
			}
			const c = swaps[ch] ?? ch;
			if (c.length > 1 || c === ch) {
				let ok = this.okChars.get(c);
				if (ok === undefined) {
					try {
						this.font.widthOfTextAtSize(c, 10);
						ok = true;
					} catch {
						ok = false;
					}
					this.okChars.set(c, ok);
				}
				out += ok ? c : "?";
			} else out += c;
		}
		return out;
	}

	private wrap(text: string, font: PDFFont, size: number, width: number): string[] {
		const lines: string[] = [];
		for (const para of this.clean(text).split("\n")) {
			const words = para.split(/\s+/).filter((w) => w);
			if (words.length === 0) {
				lines.push("");
				continue;
			}
			let line = "";
			for (const word of words) {
				const next = line ? `${line} ${word}` : word;
				if (font.widthOfTextAtSize(next, size) <= width) {
					line = next;
					continue;
				}
				if (line) lines.push(line);
				// A single word wider than the column is broken by characters.
				let rest = word;
				while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
					let n = rest.length - 1;
					while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), size) > width) n--;
					lines.push(rest.slice(0, n));
					rest = rest.slice(n);
				}
				line = rest;
			}
			lines.push(line);
		}
		return lines;
	}

	text(text: string, opts: { size?: number; bold?: boolean; color?: "muted" | "alert"; indent?: number; gap?: number } = {}): void {
		const size = opts.size ?? 10;
		const font = opts.bold ? this.bold : this.font;
		const indent = opts.indent ?? 0;
		const lh = size * 1.3;
		for (const line of this.wrap(text, font, size, this.width - indent)) {
			this.ensure(lh);
			this.y -= lh;
			this.page.drawText(line, { x: MARGIN + indent, y: this.y + size * 0.25, size, font, color: opts.color === "muted" ? MUTED : opts.color === "alert" ? ALERT : INK });
		}
		this.y -= opts.gap ?? 0;
	}

	heading(text: string): void {
		this.ensure(40);
		this.y -= 10;
		this.text(text, { size: 13, bold: true });
		this.rule();
		this.y -= 4;
	}

	rule(): void {
		this.y -= 3;
		this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: MARGIN + this.width, y: this.y }, thickness: 0.6, color: RULE });
	}

	space(h: number): void {
		this.y -= h;
	}

	bullets(items: string[], color?: "muted" | "alert"): void {
		for (const item of items) {
			const lines = this.wrap(item, this.font, 10, this.width - 14);
			lines.forEach((line, i) => {
				this.ensure(13);
				this.y -= 13;
				if (i === 0) this.page.drawText("-", { x: MARGIN + 4, y: this.y + 2.5, size: 10, font: this.font, color: INK });
				this.page.drawText(line, { x: MARGIN + 14, y: this.y + 2.5, size: 10, font: this.font, color: color === "alert" ? ALERT : color === "muted" ? MUTED : INK });
			});
		}
	}

	keyValues(pairs: [string, string][]): void {
		const keyW = 120;
		for (const [k, v] of pairs) {
			if (!v) continue;
			const lines = this.wrap(v, this.font, 10, this.width - keyW);
			lines.forEach((line, i) => {
				this.ensure(13);
				this.y -= 13;
				if (i === 0) this.page.drawText(this.clean(k), { x: MARGIN, y: this.y + 2.5, size: 10, font: this.bold, color: MUTED });
				this.page.drawText(line, { x: MARGIN + keyW, y: this.y + 2.5, size: 10, font: this.font, color: INK });
			});
		}
	}

	table(columns: Column[], rows: Row[], footRows: Row[] = []): void {
		const size = 8.5;
		const lh = size * 1.3;
		const pad = 3;
		const total = columns.reduce((s, c) => s + c.width, 0);
		const widths = columns.map((c) => (c.width / total) * this.width);
		const xs = widths.map((_, i) => MARGIN + widths.slice(0, i).reduce((s, w) => s + w, 0));
		const cell = (c: string | Cell): Cell => (typeof c === "string" ? { text: c } : c);

		const drawRow = (row: Row, header: boolean, shade: boolean) => {
			const cells = row.map(cell);
			const wrapped = cells.map((c, i) => this.wrap(c.text, header || c.bold ? this.bold : this.font, size, widths[i] - pad * 2));
			const h = Math.max(1, ...wrapped.map((l) => l.length)) * lh + pad * 2;
			if (this.y - h < MARGIN + 18) {
				this.newPage();
				if (!header) drawRow(columns.map((c) => c.header), true, false);
			}
			if (header || shade) this.page.drawRectangle({ x: MARGIN, y: this.y - h, width: this.width, height: h, color: header ? rgb(0.92, 0.92, 0.92) : rgb(0.97, 0.97, 0.97) });
			wrapped.forEach((lines, i) => {
				const c = cells[i];
				const font = header || c.bold ? this.bold : this.font;
				lines.forEach((line, j) => {
					const w = font.widthOfTextAtSize(line, size);
					const x = columns[i].align === "right" ? xs[i] + widths[i] - pad - w : xs[i] + pad;
					const color = c.color === "alert" ? ALERT : c.color === "muted" ? MUTED : INK;
					this.page.drawText(line, { x, y: this.y - pad - (j + 1) * lh + size * 0.3, size, font, color });
				});
			});
			this.y -= h;
			this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: MARGIN + this.width, y: this.y }, thickness: 0.4, color: RULE });
		};

		this.ensure(lh * 3);
		drawRow(columns.map((c) => c.header), true, false);
		for (const r of rows) drawRow(r, false, false);
		for (const r of footRows) drawRow(r.map((c) => (typeof c === "string" ? { text: c, bold: true } : { ...c, bold: true })), false, true);
		this.y -= 6;
	}

	/** Adds "Page n of N" and the footer text to every page. Call once, before appending outside documents. */
	finishFooters(): void {
		const pages = this.doc.getPages();
		pages.forEach((p, i) => {
			const label = this.clean(`${this.footerText}    Page ${i + 1} of ${pages.length}`);
			const w = this.font.widthOfTextAtSize(label, 8);
			p.drawText(label, { x: this.size[0] - MARGIN - w, y: MARGIN / 2, size: 8, font: this.font, color: MUTED });
		});
	}

	/** Appends each attachment: PDFs page by page, images scaled onto their own page. Unreadable files get a placeholder page. */
	async appendAttachments(app: App, items: { attachment: Attachment; label: string }[]): Promise<string[]> {
		const problems: string[] = [];
		for (const { attachment, label } of items) {
			const file = app.vault.getAbstractFileByPath(attachment.file);
			const name = fileName(attachment.file);
			if (!(file instanceof TFile)) {
				problems.push(`${name}: file not found in the vault`);
				this.placeholder(label, name, "The file was not found in the vault.");
				continue;
			}
			const ext = file.extension.toLowerCase();
			try {
				const bytes = await app.vault.readBinary(file);
				if (ext === "pdf") {
					const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
					if (src.isEncrypted) {
						problems.push(`${name}: password-protected, not included`);
						this.placeholder(label, name, "This PDF is password-protected and could not be included. Save an unlocked copy and attach that instead.");
						continue;
					}
					const pages = await this.doc.copyPages(src, src.getPageIndices());
					pages.forEach((p) => this.doc.addPage(p));
				} else if (ext === "png" || ext === "jpg" || ext === "jpeg") {
					const img = ext === "png" ? await this.doc.embedPng(bytes) : await this.doc.embedJpg(bytes);
					const page = this.doc.addPage(this.size);
					const maxW = this.size[0] - MARGIN * 2;
					const maxH = this.size[1] - MARGIN * 2 - 20;
					const scale = Math.min(maxW / img.width, maxH / img.height, 1);
					const w = img.width * scale;
					const h = img.height * scale;
					page.drawText(this.clean(`${label}: ${name}`), { x: MARGIN, y: this.size[1] - MARGIN + 4, size: 8, font: this.font, color: MUTED });
					page.drawImage(img, { x: (this.size[0] - w) / 2, y: this.size[1] - MARGIN - 10 - h, width: w, height: h });
				} else {
					problems.push(`${name}: file type .${ext} cannot go in a packet`);
				}
			} catch (err) {
				problems.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
				this.placeholder(label, name, "This file could not be read and was not included.");
			}
		}
		return problems;
	}

	private placeholder(label: string, name: string, why: string): void {
		this.newPage();
		this.space(200);
		this.text(label, { size: 12, bold: true });
		this.text(name, { color: "muted", gap: 8 });
		this.text(why, { color: "alert" });
	}

	async save(): Promise<Uint8Array> {
		return this.doc.save();
	}
}
