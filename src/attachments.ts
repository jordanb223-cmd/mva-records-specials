import { App, FuzzySuggestModal, normalizePath, Notice, setIcon, TFile, TFolder } from "obsidian";
import { Attachment, ATTACHMENT_KINDS, MvaSettings } from "./types";

export const PACKET_EXTENSIONS = ["pdf", "png", "jpg", "jpeg"];

/** The folder that holds a case's uploaded files and generated PDFs. */
export function caseFolder(settings: MvaSettings, caseFile: TFile): string {
	const name = (settings.caseFilesFolder || "{case} files").replace(/\{case\}/g, caseFile.basename);
	const parent = caseFile.parent && caseFile.parent.path !== "/" ? caseFile.parent.path + "/" : "";
	return normalizePath(parent + name);
}

export async function ensureFolder(app: App, path: string): Promise<void> {
	const parts = normalizePath(path).split("/");
	let cur = "";
	for (const part of parts) {
		cur = cur ? `${cur}/${part}` : part;
		const existing = app.vault.getAbstractFileByPath(cur);
		if (!existing) await app.vault.createFolder(cur);
		else if (!(existing instanceof TFolder)) throw new Error(`"${cur}" is a file, not a folder.`);
	}
}

/** Returns a path in `folder` that does not exist yet, adding " (2)", " (3)" ... when needed. */
export function freePath(app: App, folder: string, fileName: string): string {
	const dot = fileName.lastIndexOf(".");
	const base = dot > 0 ? fileName.slice(0, dot) : fileName;
	const ext = dot > 0 ? fileName.slice(dot) : "";
	let path = normalizePath(`${folder}/${base}${ext}`);
	for (let n = 2; app.vault.getAbstractFileByPath(path); n++) path = normalizePath(`${folder}/${base} (${n})${ext}`);
	return path;
}

/** Opens the system file picker and copies the chosen files into the vault. Resolves with the new vault paths. */
export function uploadFiles(app: App, folder: string): Promise<string[]> {
	return new Promise((resolve) => {
		const input = document.body.createEl("input", { type: "file", attr: { accept: ".pdf,.png,.jpg,.jpeg", multiple: "" } });
		input.addClass("mva-hidden");
		input.addEventListener("change", () => {
			void (async () => {
				const out: string[] = [];
				try {
					const files = Array.from(input.files ?? []);
					if (files.length) await ensureFolder(app, folder);
					for (const f of files) {
						const path = freePath(app, folder, f.name);
						await app.vault.createBinary(path, await f.arrayBuffer());
						out.push(path);
					}
					if (out.length) new Notice(`Added ${out.length} file${out.length > 1 ? "s" : ""} to "${folder}".`);
				} catch (err) {
					new Notice(`Upload failed: ${err instanceof Error ? err.message : String(err)}`);
				} finally {
					input.remove();
					resolve(out);
				}
			})();
		});
		input.click();
	});
}

export class VaultFileSuggest extends FuzzySuggestModal<TFile> {
	constructor(app: App, private onChoose: (f: TFile) => void) {
		super(app);
		this.setPlaceholder("Link a PDF or image already in the vault");
	}

	getItems(): TFile[] {
		return this.app.vault.getFiles().filter((f) => PACKET_EXTENSIONS.includes(f.extension.toLowerCase()));
	}

	getItemText(item: TFile): string {
		return item.path;
	}

	onChooseItem(item: TFile): void {
		this.onChoose(item);
	}
}

export function fileName(path: string): string {
	return path.split("/").pop() ?? path;
}

export function openAttachment(app: App, path: string, sourcePath = ""): void {
	void app.workspace.openLinkText(path, sourcePath, true);
}

/**
 * The attachments section of the request and encounter forms. Edits `list` in place.
 * `folder` is where uploads go; null hides the upload button (no case note to file them under).
 */
export function attachmentEditor(app: App, parent: HTMLElement, list: Attachment[], folder: string | null, defaultKind: string): void {
	const wrap = parent.createDiv({ cls: "mva-attach-editor" });
	wrap.createDiv({ cls: "setting-item-name", text: "Attachments" });
	wrap.createDiv({ cls: "setting-item-description", text: "Checked files go into printed packets." });
	const rows = wrap.createDiv({ cls: "mva-attach-rows" });

	const draw = () => {
		rows.empty();
		if (list.length === 0) rows.createDiv({ cls: "mva-note", text: "None yet." });
		list.forEach((a, i) => {
			const row = rows.createDiv({ cls: "mva-attach-row" });
			const inc = row.createEl("input", { type: "checkbox", attr: { "aria-label": "Include in packets" } });
			inc.checked = a.include;
			inc.addEventListener("change", () => (a.include = inc.checked));
			const name = row.createEl("a", { cls: "mva-attach-name", text: fileName(a.file) });
			name.addEventListener("click", (e) => {
				e.preventDefault();
				openAttachment(app, a.file);
			});
			if (!app.vault.getAbstractFileByPath(a.file)) row.createSpan({ cls: "mva-pill mva-pill-overdue", text: "Missing file" });
			const kind = row.createEl("select", { cls: "dropdown" });
			for (const k of [...ATTACHMENT_KINDS, ...(ATTACHMENT_KINDS.includes(a.kind) ? [] : [a.kind])]) kind.createEl("option", { text: k, value: k });
			kind.value = a.kind;
			kind.addEventListener("change", () => (a.kind = kind.value));
			const up = row.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Move up" } });
			setIcon(up, "arrow-up");
			up.disabled = i === 0;
			up.addEventListener("click", () => {
				[list[i - 1], list[i]] = [list[i], list[i - 1]];
				draw();
			});
			const del = row.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Remove from this entry (the file stays in the vault)" } });
			setIcon(del, "x");
			del.addEventListener("click", () => {
				list.splice(i, 1);
				draw();
			});
		});
	};
	draw();

	const buttons = wrap.createDiv({ cls: "mva-attach-buttons" });
	if (folder) {
		const upload = buttons.createEl("button", { text: "Upload from computer" });
		const addUploads = async () => {
			const paths = await uploadFiles(app, folder);
			for (const p of paths) list.push({ file: p, kind: defaultKind, include: true });
			draw();
		};
		upload.addEventListener("click", () => void addUploads());
	}
	const link = buttons.createEl("button", { text: "Link vault file" });
	link.addEventListener("click", () =>
		new VaultFileSuggest(app, (f) => {
			if (!list.some((a) => a.file === f.path)) list.push({ file: f.path, kind: defaultKind, include: true });
			draw();
		}).open()
	);
}

/** A row of paperclip links under a card or table row. */
export function attachmentLinks(app: App, parent: HTMLElement, list: Attachment[], sourcePath: string): void {
	if (list.length === 0) return;
	const box = parent.createDiv({ cls: "mva-attach-links" });
	const clip = box.createSpan({ cls: "mva-attach-clip" });
	setIcon(clip, "paperclip");
	list.forEach((a, i) => {
		if (i) box.appendText(", ");
		const link = box.createEl("a", { text: fileName(a.file), cls: a.include ? "" : "mva-excluded-link" });
		link.setAttr("aria-label", `${a.kind}${a.include ? "" : " (not in packets)"}`);
		link.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			openAttachment(app, a.file, sourcePath);
		});
	});
}
