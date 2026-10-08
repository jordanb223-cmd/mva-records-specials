import { Editor, MarkdownView, normalizePath, Notice, Plugin, TFile } from "obsidian";
import { CaseData, DASHBOARD_VIEW, DashboardView } from "./dashboard";
import { addDays, encounterToYaml, findBlocks, parseEncounters, parseRequests, replaceBlockBody, requestToYaml, serializeList, today } from "./data";
import { caseFolder } from "./attachments";
import { buildCaseReport, buildRequestPacket, ReportModal, saveAndOpen } from "./reports";
import { ApplyPlaybookModal, EncounterModal, PlaybookSuggestModal, RequestModal } from "./modals";
import { createSamplePlaybooks, listPlaybookFiles, playbookChecklist, readPlaybook } from "./playbooks";
import { registerBlocks } from "./render";
import { MvaSettingTab } from "./settings";
import { DEFAULT_SETTINGS, Encounter, MvaSettings, RecordRequest, REQUESTS_LANG, SPECIALS_LANG } from "./types";

const HEADINGS: Record<string, string> = {
	[REQUESTS_LANG]: "Records requests",
	[SPECIALS_LANG]: "Medical specials",
};

export default class MvaPlugin extends Plugin {
	settings: MvaSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();
		registerBlocks(this);
		this.registerView(DASHBOARD_VIEW, (leaf) => new DashboardView(leaf, this));
		this.addSettingTab(new MvaSettingTab(this.app, this));

		this.addRibbonIcon("folder-heart", "Open records dashboard", () => void this.openDashboard());

		this.addCommand({
			id: "open-dashboard",
			name: "Open records dashboard",
			callback: () => void this.openDashboard(),
		});

		this.addCommand({
			id: "add-request",
			name: "Add records request to this note",
			editorCallback: (editor, ctx) =>
				new RequestModal(
					this.app,
					this.settings,
					null,
					(r) => this.editInEditor(editor, REQUESTS_LANG, parseRequests, requestToYaml, (list) => [...list, r]),
					undefined,
					ctx.file ? this.caseDefaults(ctx.file) : undefined,
					ctx.file ? caseFolder(this.settings, ctx.file) : null
				).open(),
		});

		this.addCommand({
			id: "add-encounter",
			name: "Add encounter (date of service) to this note",
			editorCallback: (editor, ctx) =>
				new EncounterModal(
					this.app,
					null,
					(e) => this.editInEditor(editor, SPECIALS_LANG, parseEncounters, encounterToYaml, (list) => [...list, e]),
					undefined,
					ctx.file ? caseFolder(this.settings, ctx.file) : null
				).open(),
		});

		this.addCommand({
			id: "apply-playbook",
			name: "Insert records playbook in this note",
			editorCallback: (editor) => this.applyPlaybook(editor),
		});

		this.addCommand({
			id: "case-report",
			name: "Build case report for this note",
			checkCallback: (checking) => {
				const file = this.reportTarget();
				if (!file) return false;
				if (!checking) this.openReportModal(file);
				return true;
			},
		});

		this.addCommand({
			id: "create-sample-playbooks",
			name: "Create sample playbooks",
			callback: () => void this.createSamples(),
		});
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<MvaSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async openDashboard(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(DASHBOARD_VIEW);
		if (existing.length) {
			await this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: DASHBOARD_VIEW, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	createSamples(): Promise<void> {
		return createSamplePlaybooks(this.app, this.settings.playbookFolder);
	}

	// ---------- Request actions shared by tables and dashboard ----------

	logFollowUp(r: RecordRequest): RecordRequest {
		const now = today();
		return { ...r, followups: [...r.followups, now], followup: addDays(now, this.settings.followUpDays) };
	}

	markReceived(r: RecordRequest): RecordRequest {
		return { ...r, state: "complete", received: today(), missing: [] };
	}

	/** Pre-fills a new request's scope from the case note's `doi` frontmatter, if present. */
	caseDefaults(file: TFile): Partial<RecordRequest> {
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const raw: unknown = fm?.doi ?? fm?.date_of_incident;
		const doi = typeof raw === "string" ? raw.trim() : "";
		return /^\d{4}-\d{2}-\d{2}$/.test(doi) ? { scopeFrom: doi } : {};
	}

	// ---------- Writing blocks ----------

	/** Edits a block in a file that may not be open. Parses the current text first so a stale render never overwrites newer data. */
	private async mutateFile<T extends object>(
		file: TFile,
		lang: string,
		parse: (src: string) => T[],
		toYaml: (item: T) => object,
		mutate: (list: T[]) => T[],
		atLine?: number
	): Promise<void> {
		try {
			await this.app.vault.process(file, (text) => {
				const blocks = findBlocks(text, lang);
				const target = atLine === undefined ? blocks[0] : blocks.find((b) => b.start === atLine);
				if (atLine !== undefined && !target) throw new Error("The block moved while you were editing. Try again.");
				const next = mutate(target ? parse(target.body) : []);
				return replaceBlockBody(text, lang, serializeList(next.map(toYaml)), target?.start, HEADINGS[lang]);
			});
		} catch (err) {
			new Notice(`Could not update ${file.basename}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	mutateRequests(file: TFile, mutate: (list: RecordRequest[]) => RecordRequest[], atLine?: number): Promise<void> {
		return this.mutateFile(file, REQUESTS_LANG, parseRequests, requestToYaml, mutate, atLine);
	}

	mutateSpecials(file: TFile, mutate: (list: Encounter[]) => Encounter[], atLine?: number): Promise<void> {
		return this.mutateFile(file, SPECIALS_LANG, parseEncounters, encounterToYaml, mutate, atLine);
	}

	/** Finds the request by id in whichever request block holds it. */
	async mutateRequestById(file: TFile, id: string, change: (r: RecordRequest) => RecordRequest): Promise<void> {
		const text = await this.app.vault.read(file);
		for (const b of findBlocks(text, REQUESTS_LANG)) {
			let list: RecordRequest[];
			try {
				list = parseRequests(b.body);
			} catch {
				continue;
			}
			if (list.some((r) => r.id === id)) {
				await this.mutateRequests(file, (l) => l.map((r) => (r.id === id ? change(r) : r)), b.start);
				return;
			}
		}
		new Notice("That request was not found. It may have been edited elsewhere.");
	}

	/** Edits the first block of a kind in the open editor, so the change joins the editor's undo history. */
	private editInEditor<T extends object>(editor: Editor, lang: string, parse: (src: string) => T[], toYaml: (item: T) => object, mutate: (list: T[]) => T[]): void {
		const text = editor.getValue();
		const block = findBlocks(text, lang)[0];
		let list: T[] = [];
		if (block) {
			try {
				list = parse(block.body);
			} catch (err) {
				new Notice(`Could not read the existing block: ${err instanceof Error ? err.message : String(err)}`);
				return;
			}
		}
		const body = serializeList(mutate(list).map(toYaml));
		if (block) {
			editor.replaceRange(body ? body + "\n" : "", { line: block.start + 1, ch: 0 }, { line: block.end, ch: 0 });
			return;
		}
		const appended = replaceBlockBody(text, lang, body, undefined, HEADINGS[lang]);
		const lastLine = editor.lastLine();
		editor.replaceRange(appended.slice(text.length), { line: lastLine, ch: editor.getLine(lastLine).length });
	}

	private applyPlaybook(editor: Editor): void {
		const files = listPlaybookFiles(this.app, this.settings.playbookFolder);
		if (files.length === 0) {
			new Notice(`No playbooks found in "${normalizePath(this.settings.playbookFolder)}". Run "Create sample playbooks" to start.`);
			return;
		}
		new PlaybookSuggestModal(this.app, files, (file) => void this.startPlaybook(editor, file)).open();
	}

	private async startPlaybook(editor: Editor, file: TFile): Promise<void> {
		const pb = await readPlaybook(this.app, file);
		if (pb.steps.length === 0) {
			new Notice(`"${pb.name}" has no task lines (- [ ] ...).`);
			return;
		}
		new ApplyPlaybookModal(this.app, pb.name, ({ provider, addRequest }) => {
			// Insert below the cursor's line, never inside it, with a blank line before the heading.
			const cur = editor.getCursor();
			const lineText = editor.getLine(cur.line);
			editor.setCursor({ line: cur.line, ch: lineText.length });
			editor.replaceSelection((lineText.trim() ? "\n\n" : "") + playbookChecklist(pb, provider));
			if (!addRequest) return;
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			new RequestModal(
				this.app,
				this.settings,
				null,
				(r) => this.editInEditor(editor, REQUESTS_LANG, parseRequests, requestToYaml, (list) => [...list, r]),
				undefined,
				{
					...(view?.file ? this.caseDefaults(view.file) : {}),
					provider,
					type: pb.recordType,
					method: pb.method,
					delivery: pb.delivery,
					enclosures: [...pb.enclosures],
					notes: `Playbook: ${pb.name}`,
				},
				view?.file ? caseFolder(this.settings, view.file) : null
			).open();
		}).open();
	}

	// ---------- Printing ----------

	/** The active note, or — when a PDF or other tab is in front — the most recently opened note. */
	private reportTarget(): TFile | null {
		const active = this.app.workspace.getActiveFile();
		if (active?.extension === "md") return active;
		for (const path of this.app.workspace.getLastOpenFiles()) {
			const f = this.app.vault.getAbstractFileByPath(path);
			if (f instanceof TFile && f.extension === "md") return f;
		}
		return null;
	}

	openReportModal(file: TFile): void {
		new ReportModal(this.app, file.basename, this.settings.lastPrivileged, (opts) => {
			this.settings.lastPrivileged = opts.privileged;
			void this.saveSettings();
			void (async () => {
				try {
					const data = await this.caseData(file);
					new Notice("Building report…");
					const built = await buildCaseReport(this.app, this.settings, data, opts);
					await saveAndOpen(this.app, this.settings, file, opts.title, built);
				} catch (err) {
					new Notice(`Report failed: ${err instanceof Error ? err.message : String(err)}`);
				}
			})();
		}).open();
	}

	async buildPacket(file: TFile, requestId: string): Promise<void> {
		try {
			const data = await this.caseData(file);
			const r = data.requests.find((x) => x.id === requestId);
			if (!r) throw new Error("request not found");
			new Notice("Building packet…");
			const built = await buildRequestPacket(this.app, this.settings, data, r);
			await saveAndOpen(this.app, this.settings, file, `Request packet - ${r.provider}`, built);
		} catch (err) {
			new Notice(`Packet failed: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	// ---------- Reading the vault ----------

	/** Reads one case note's blocks. Malformed blocks are counted, not thrown. */
	async caseData(file: TFile, cachedText?: string): Promise<CaseData> {
		const text = cachedText ?? (await this.app.vault.read(file));
		const data: CaseData = { file, name: file.basename, requests: [], encounters: [], errors: 0 };
		for (const b of findBlocks(text, REQUESTS_LANG)) {
			try {
				data.requests.push(...parseRequests(b.body));
			} catch {
				data.errors++;
			}
		}
		for (const b of findBlocks(text, SPECIALS_LANG)) {
			try {
				data.encounters.push(...parseEncounters(b.body));
			} catch {
				data.errors++;
			}
		}
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const label = fm && (typeof fm.client === "string" ? fm.client : typeof fm.case === "string" ? fm.case : "");
		if (label) data.name = label;
		return data;
	}

	async collectCases(): Promise<CaseData[]> {
		const playbookRoot = normalizePath(this.settings.playbookFolder) + "/";
		const out: CaseData[] = [];
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (file.path.startsWith(playbookRoot)) continue;
			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache?.sections?.some((s) => s.type === "code")) continue;
			const text = await this.app.vault.cachedRead(file);
			if (!text.includes("```" + REQUESTS_LANG) && !text.includes("```" + SPECIALS_LANG) && !text.includes("~~~")) continue;
			const data = await this.caseData(file, text);
			if (data.requests.length || data.encounters.length || data.errors) out.push(data);
		}
		return out.sort((a, b) => a.name.localeCompare(b.name));
	}
}
