import { App, normalizePath, Notice, TFile, TFolder } from "obsidian";

export interface Playbook {
	file: TFile;
	name: string;
	recordType: string;
	method: string;
	delivery: string;
	enclosures: string[];
	steps: string[];
}

const TASK = /^\s*[-*+]\s+\[.\]\s+(.*)$/;

export function listPlaybookFiles(app: App, folder: string): TFile[] {
	const root = app.vault.getAbstractFileByPath(normalizePath(folder));
	if (!(root instanceof TFolder)) return [];
	const out: TFile[] = [];
	const walk = (f: TFolder) => {
		for (const child of f.children) {
			if (child instanceof TFolder) walk(child);
			else if (child instanceof TFile && child.extension === "md") out.push(child);
		}
	};
	walk(root);
	return out.sort((a, b) => a.basename.localeCompare(b.basename));
}

export async function readPlaybook(app: App, file: TFile): Promise<Playbook> {
	const text = await app.vault.cachedRead(file);
	const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
	const steps: string[] = [];
	for (const line of text.split("\n")) {
		const m = TASK.exec(line);
		if (m) steps.push(m[1].trim());
	}
	return {
		file,
		name: file.basename,
		recordType: typeof fm.record_type === "string" ? fm.record_type : "",
		method: typeof fm.method === "string" ? fm.method : "",
		delivery: typeof fm.delivery === "string" ? fm.delivery : "",
		enclosures: Array.isArray(fm.enclosures) ? fm.enclosures.filter((x: unknown): x is string => typeof x === "string") : [],
		steps,
	};
}

export function playbookChecklist(p: Playbook, provider: string): string {
	const lines = [`### ${p.name} — ${provider}`, ""];
	for (const s of p.steps) lines.push(`- [ ] ${s}`);
	return lines.join("\n") + "\n";
}

const SAMPLES: Record<string, string> = {
	"Medical records request": `---
record_type: Medical records
method: Fax
delivery: Encrypted email
enclosures:
  - Letter of representation
  - HIPAA authorization
---
Steps for getting a complete chart from a treating provider. Edit these to match your office's process. Every task line below is copied into the case note when you apply this playbook.

- [ ] Confirm the records department contact and how they accept requests
- [ ] Check whether the provider requires its own authorization form
- [ ] Get the client's signed authorization
- [ ] Send the request with the authorization and letter of representation
- [ ] Pay the copy fee if one is invoiced
- [ ] Follow up if nothing arrives by the follow-up date
- [ ] Check the records cover every date of service
- [ ] If anything is missing, mark the request partial and list what is missing
- [ ] Send a follow-up request for the missing items
`,
	"Itemized billing request": `---
record_type: Itemized bill
method: Fax
delivery: Encrypted email
enclosures:
  - Letter of representation
  - HIPAA authorization
---
Steps for getting the itemized bill and payment ledger used for specials.

- [ ] Ask the billing office (not records) for an itemized statement with CPT codes
- [ ] Ask for the payment ledger showing payments and adjustments
- [ ] Ask whether any lien has been asserted, and by whom
- [ ] Follow up if nothing arrives by the follow-up date
- [ ] Enter each date of service as an encounter, with billed, paid, and adjusted amounts
- [ ] Check every billed date has treatment records, and every treatment date has a bill
`,
	"Imaging request": `---
record_type: Imaging
method: Mail
delivery: Mail
enclosures:
  - Letter of representation
  - HIPAA authorization
---
Steps for getting imaging studies and the radiology reports.

- [ ] Confirm which facility holds the studies
- [ ] Request the images on disc or by download link
- [ ] Request the radiologist's written reports
- [ ] Follow up if nothing arrives by the follow-up date
- [ ] Confirm the disc opens and every study is present
`,
};

export async function createSamplePlaybooks(app: App, folder: string): Promise<void> {
	const dir = normalizePath(folder);
	if (!app.vault.getAbstractFileByPath(dir)) await app.vault.createFolder(dir);
	let created = 0;
	for (const [name, body] of Object.entries(SAMPLES)) {
		const path = normalizePath(`${dir}/${name}.md`);
		if (app.vault.getAbstractFileByPath(path)) continue;
		await app.vault.create(path, body);
		created++;
	}
	new Notice(created ? `Created ${created} sample playbook${created > 1 ? "s" : ""} in "${dir}".` : `Sample playbooks already exist in "${dir}".`);
}
