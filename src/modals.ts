import { App, FuzzySuggestModal, Modal, Notice, Setting, TextComponent, TFile } from "obsidian";
import { attachmentEditor } from "./attachments";
import { addDays, newId, today } from "./data";
import { Encounter, MvaSettings, ReceiptState, RecordRequest, Relatedness } from "./types";

function dateField(setting: Setting, value: string, onChange: (v: string) => void): TextComponent {
	let comp!: TextComponent;
	setting.addText((t) => {
		comp = t;
		t.inputEl.type = "date";
		t.setValue(value).onChange(onChange);
	});
	return comp;
}

function moneyField(setting: Setting, value: number | null, onChange: (v: number | null) => void): void {
	setting.addText((t) => {
		t.inputEl.type = "number";
		t.inputEl.step = "0.01";
		t.inputEl.min = "0";
		t.setPlaceholder("0.00")
			.setValue(value === null ? "" : String(value))
			.onChange((v) => {
				const n = parseFloat(v);
				onChange(v.trim() === "" || !isFinite(n) ? null : n);
			});
	});
}

/** Dropdown with the configured choices, plus the current value if it is not one of them. */
function choiceField(setting: Setting, choices: string[], value: string, onChange: (v: string) => void): void {
	setting.addDropdown((d) => {
		d.addOption("", "—");
		for (const c of choices) d.addOption(c, c);
		if (value && !choices.includes(value)) d.addOption(value, value);
		d.setValue(value).onChange(onChange);
	});
}

/** One checkbox per option; values not in the option list are kept and shown too. */
function checklistField(parent: HTMLElement, name: string, desc: string, options: string[], selected: string[]): void {
	const setting = new Setting(parent).setName(name).setDesc(desc);
	setting.settingEl.addClass("mva-checklist-setting");
	const box = setting.controlEl.createDiv({ cls: "mva-checklist" });
	const all = [...options, ...selected.filter((s) => !options.includes(s))];
	for (const opt of all) {
		const label = box.createEl("label", { cls: "mva-check" });
		const input = label.createEl("input", { type: "checkbox" });
		input.checked = selected.includes(opt);
		input.addEventListener("change", () => {
			const i = selected.indexOf(opt);
			if (input.checked && i < 0) selected.push(opt);
			if (!input.checked && i >= 0) selected.splice(i, 1);
		});
		label.appendText(opt);
	}
}

function linesField(setting: Setting, value: string[], placeholder: string, onChange: (v: string[]) => void): void {
	setting.addTextArea((t) => {
		t.inputEl.rows = 4;
		t.setPlaceholder(placeholder)
			.setValue(value.join("\n"))
			.onChange((v) =>
				onChange(
					v
						.split("\n")
						.map((s) => s.trim())
						.filter((s) => s)
				)
			);
	});
}

function footer(modal: Modal, isNew: boolean, onSave: () => void, onDelete?: () => void): void {
	const row = new Setting(modal.contentEl);
	if (!isNew && onDelete) {
		row.addButton((b) =>
			b
				.setButtonText("Delete")
				.setWarning()
				.onClick(() => {
					onDelete();
					modal.close();
				})
		);
	}
	row.addButton((b) => b.setButtonText("Cancel").onClick(() => modal.close()));
	row.addButton((b) =>
		b
			.setButtonText(isNew ? "Add" : "Save")
			.setCta()
			.onClick(onSave)
	);
}

export function blankRequest(settings: MvaSettings): RecordRequest {
	const requested = today();
	return {
		id: newId(),
		provider: "",
		type: "",
		method: "",
		delivery: "",
		requested,
		followup: addDays(requested, settings.followUpDays),
		deadline: "",
		scopeFrom: "",
		scopeTo: "",
		categories: "",
		enclosures: [],
		state: "sent",
		received: "",
		missing: [],
		cost: null,
		followups: [],
		attachments: [],
		notes: "",
	};
}

export class RequestModal extends Modal {
	private draft: RecordRequest;
	private isNew: boolean;

	constructor(
		app: App,
		private settings: MvaSettings,
		initial: RecordRequest | null,
		private onSubmit: (r: RecordRequest) => void,
		private onDelete?: (r: RecordRequest) => void,
		/** Pre-filled values for a new request, such as a date-of-incident scope. */
		defaults?: Partial<RecordRequest>,
		/** Where uploaded files go. Null when there is no case note to file them under. */
		private folder: string | null = null
	) {
		super(app);
		this.isNew = initial === null;
		this.draft = initial
			? {
					...initial,
					enclosures: [...initial.enclosures],
					missing: [...initial.missing],
					followups: [...initial.followups],
					attachments: initial.attachments.map((a) => ({ ...a })),
			  }
			: { ...blankRequest(settings), ...defaults };
	}

	onOpen(): void {
		const { contentEl } = this;
		const d = this.draft;
		const s = this.settings;
		this.setTitle(this.isNew ? "New records request" : "Edit records request");
		this.modalEl.addClass("mva-modal");

		new Setting(contentEl).setName("Provider").addText((t) => {
			t.setPlaceholder("Who the request is addressed to").setValue(d.provider).onChange((v) => (d.provider = v.trim()));
			window.setTimeout(() => t.inputEl.focus(), 0);
		});
		choiceField(new Setting(contentEl).setName("Record type"), s.recordTypes, d.type, (v) => (d.type = v));

		new Setting(contentEl).setName("Scope").setHeading();
		dateField(new Setting(contentEl).setName("Records from"), d.scopeFrom, (v) => (d.scopeFrom = v));
		dateField(new Setting(contentEl).setName("Records to").setDesc("Leave blank for \"to present\"."), d.scopeTo, (v) => (d.scopeTo = v));
		new Setting(contentEl)
			.setName("Categories")
			.setDesc("What the request asks for: chart notes, imaging reports, itemized billing, and so on.")
			.addTextArea((t) => t.setValue(d.categories).onChange((v) => (d.categories = v.trim())));

		new Setting(contentEl).setName("Packet").setHeading();
		checklistField(contentEl, "Enclosures", "What went out with the request.", s.enclosureTypes, d.enclosures);
		choiceField(new Setting(contentEl).setName("Sent by"), s.requestMethods, d.method, (v) => (d.method = v));
		choiceField(new Setting(contentEl).setName("Return records by").setDesc("How the provider should send them back."), s.deliveryMethods, d.delivery, (v) => (d.delivery = v));

		new Setting(contentEl).setName("Dates").setHeading();
		let followupInput: TextComponent | null = null;
		let followupTouched = !this.isNew;
		dateField(new Setting(contentEl).setName("Date sent"), d.requested, (v) => {
			d.requested = v;
			if (!followupTouched && v && followupInput) {
				d.followup = addDays(v, s.followUpDays);
				followupInput.setValue(d.followup);
			}
		});
		dateField(new Setting(contentEl).setName("Production deadline").setDesc("The date the letter asks for. Optional."), d.deadline, (v) => (d.deadline = v));
		followupInput = dateField(new Setting(contentEl).setName("Follow up on").setDesc(`Your own reminder. Defaults to ${s.followUpDays} days after sending.`), d.followup, (v) => {
			followupTouched = true;
			d.followup = v;
		});

		if (!this.isNew) {
			new Setting(contentEl).setName("Production").setHeading();
			new Setting(contentEl).setName("Status").addDropdown((dd) =>
				dd
					.addOption("sent", "Sent, waiting")
					.addOption("partial", "Received, partial")
					.addOption("complete", "Received, complete")
					.setValue(d.state)
					.onChange((v) => (d.state = v as ReceiptState))
			);
			dateField(new Setting(contentEl).setName("Date received"), d.received, (v) => (d.received = v));
			linesField(new Setting(contentEl).setName("Still missing").setDesc("One item per line."), d.missing, "12/11/2024 visit notes", (v) => (d.missing = v));
		}

		moneyField(new Setting(contentEl).setName("Fee / cost"), d.cost, (v) => (d.cost = v));
		attachmentEditor(this.app, contentEl, d.attachments, this.folder, "Other");
		new Setting(contentEl).setName("Notes").addTextArea((t) => t.setValue(d.notes).onChange((v) => (d.notes = v.trim())));

		footer(
			this,
			this.isNew,
			() => {
				if (!d.provider) {
					new Notice("Enter a provider name.");
					return;
				}
				if (d.state !== "sent" && !d.received) d.received = today();
				if (d.state === "complete") d.missing = [];
				this.onSubmit(d);
				this.close();
			},
			this.onDelete ? () => this.onDelete?.(d) : undefined
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** Records what came back: complete, or partial with the list of what is still missing. */
export class ReceiveModal extends Modal {
	private state: ReceiptState = "complete";
	private received = today();
	private missing: string[];

	private followup: string;
	private attachments: RecordRequest["attachments"];

	constructor(
		app: App,
		private request: RecordRequest,
		private followUpDays: number,
		private onSubmit: (r: RecordRequest) => void,
		private folder: string | null = null
	) {
		super(app);
		this.missing = [...request.missing];
		this.attachments = request.attachments.map((a) => ({ ...a }));
		if (request.state === "partial") this.state = "partial";
		this.followup = addDays(this.received, followUpDays);
	}

	onOpen(): void {
		const { contentEl } = this;
		this.setTitle(`Production from ${this.request.provider}`);
		const partialOnly: HTMLElement[] = [];
		const showPartial = () => partialOnly.forEach((el) => el.toggleClass("mva-hidden", this.state !== "partial"));
		let followupInput: TextComponent | null = null;
		new Setting(contentEl).setName("Is it complete?").addDropdown((dd) =>
			dd
				.addOption("complete", "Yes, complete")
				.addOption("partial", "No, items are missing")
				.setValue(this.state)
				.onChange((v) => {
					this.state = v as ReceiptState;
					showPartial();
				})
		);
		dateField(new Setting(contentEl).setName("Date received"), this.received, (v) => {
			this.received = v;
			if (v && followupInput) {
				this.followup = addDays(v, this.followUpDays);
				followupInput.setValue(this.followup);
			}
		});
		const missingSetting = new Setting(contentEl)
			.setName("What is missing")
			.setDesc("One item per line, such as a billed visit with no notes. This becomes your follow-up list.");
		linesField(missingSetting, this.missing, "12/11/2024 visit notes\nMRI report and images", (v) => (this.missing = v));
		partialOnly.push(missingSetting.settingEl);
		const followSetting = new Setting(contentEl).setName("Follow up on").setDesc("When to chase the missing items.");
		followupInput = dateField(followSetting, this.followup, (v) => (this.followup = v));
		partialOnly.push(followSetting.settingEl);
		showPartial();
		attachmentEditor(this.app, contentEl, this.attachments, this.folder, "Records");

		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText("Save")
					.setCta()
					.onClick(() => {
						if (this.state === "partial" && this.missing.length === 0) {
							new Notice("List at least one missing item, or mark it complete.");
							return;
						}
						this.onSubmit({
							...this.request,
							state: this.state,
							received: this.received || today(),
							missing: this.state === "partial" ? this.missing : [],
							followup: this.state === "partial" ? this.followup : this.request.followup,
							attachments: this.attachments,
						});
						this.close();
					})
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class EncounterModal extends Modal {
	private draft: Encounter;
	private isNew: boolean;

	constructor(
		app: App,
		initial: Encounter | null,
		private onSubmit: (e: Encounter) => void,
		private onDelete?: (e: Encounter) => void,
		private folder: string | null = null
	) {
		super(app);
		this.isNew = initial === null;
		this.draft = initial
			? { ...initial, attachments: initial.attachments.map((a) => ({ ...a })) }
			: {
					id: newId(),
					date: "",
					provider: "",
					service: "",
					related: "unknown",
					relatedReason: "",
					records: false,
					bill: false,
					billed: null,
					planPaid: null,
					patientPaid: null,
					adjusted: null,
					lienHolder: "",
					lienAmount: null,
					collections: "",
					attachments: [],
					notes: "",
			  };
	}

	onOpen(): void {
		const { contentEl } = this;
		const d = this.draft;
		this.setTitle(this.isNew ? "New encounter" : "Edit encounter");
		this.modalEl.addClass("mva-modal");

		dateField(new Setting(contentEl).setName("Date of service"), d.date, (v) => (d.date = v));
		new Setting(contentEl).setName("Provider").addText((t) => {
			t.setValue(d.provider).onChange((v) => (d.provider = v.trim()));
			window.setTimeout(() => t.inputEl.focus(), 0);
		});
		new Setting(contentEl)
			.setName("Service")
			.setDesc("What happened at this visit.")
			.addText((t) => t.setPlaceholder("Neck and back exam").setValue(d.service).onChange((v) => (d.service = v.trim())));

		new Setting(contentEl).setName("Related to the incident?").addDropdown((dd) =>
			dd
				.addOption("unknown", "Unknown")
				.addOption("yes", "Related")
				.addOption("no", "Not related")
				.setValue(d.related)
				.onChange((v) => (d.related = v as Relatedness))
		);
		new Setting(contentEl)
			.setName("Reason")
			.setDesc("Why it is or is not related. Kept so exclusions can be explained.")
			.addText((t) => t.setValue(d.relatedReason).onChange((v) => (d.relatedReason = v.trim())));

		new Setting(contentEl).setName("Documents in hand").setHeading();
		new Setting(contentEl).setName("Treatment records").addToggle((t) => t.setValue(d.records).onChange((v) => (d.records = v)));
		new Setting(contentEl).setName("Bill / ledger entry").addToggle((t) => t.setValue(d.bill).onChange((v) => (d.bill = v)));

		new Setting(contentEl).setName("Money").setHeading();
		moneyField(new Setting(contentEl).setName("Billed"), d.billed, (v) => (d.billed = v));
		moneyField(new Setting(contentEl).setName("Paid by health plan"), d.planPaid, (v) => (d.planPaid = v));
		moneyField(new Setting(contentEl).setName("Paid by patient").setDesc("Copays, deductibles, cash pay."), d.patientPaid, (v) => (d.patientPaid = v));
		moneyField(new Setting(contentEl).setName("Adjusted / written off"), d.adjusted, (v) => (d.adjusted = v));
		new Setting(contentEl).setName("Lien holder").addText((t) => t.setValue(d.lienHolder).onChange((v) => (d.lienHolder = v.trim())));
		moneyField(new Setting(contentEl).setName("Lien amount"), d.lienAmount, (v) => (d.lienAmount = v));
		new Setting(contentEl)
			.setName("In collections with")
			.addText((t) => t.setPlaceholder("Agency name").setValue(d.collections).onChange((v) => (d.collections = v.trim())));
		attachmentEditor(this.app, contentEl, d.attachments, this.folder, "Bill / ledger");
		new Setting(contentEl).setName("Notes").addTextArea((t) => t.setValue(d.notes).onChange((v) => (d.notes = v.trim())));

		footer(
			this,
			this.isNew,
			() => {
				if (!d.provider) {
					new Notice("Enter a provider name.");
					return;
				}
				this.onSubmit(d);
				this.close();
			},
			this.onDelete ? () => this.onDelete?.(d) : undefined
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class PlaybookSuggestModal extends FuzzySuggestModal<TFile> {
	constructor(app: App, private playbooks: TFile[], private onChoose: (f: TFile) => void) {
		super(app);
		this.setPlaceholder("Choose a playbook");
	}

	getItems(): TFile[] {
		return this.playbooks;
	}

	getItemText(item: TFile): string {
		return item.basename;
	}

	onChooseItem(item: TFile): void {
		this.onChoose(item);
	}
}

export interface ApplyPlaybookChoice {
	provider: string;
	addRequest: boolean;
}

export class ApplyPlaybookModal extends Modal {
	private choice: ApplyPlaybookChoice = { provider: "", addRequest: true };

	constructor(app: App, private playbookName: string, private onSubmit: (c: ApplyPlaybookChoice) => void) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		this.setTitle(`Apply "${this.playbookName}"`);
		new Setting(contentEl).setName("Provider").addText((t) => {
			t.onChange((v) => (this.choice.provider = v.trim()));
			window.setTimeout(() => t.inputEl.focus(), 0);
		});
		new Setting(contentEl)
			.setName("Also log a records request")
			.setDesc("Opens the request form, pre-filled from the playbook.")
			.addToggle((t) => t.setValue(this.choice.addRequest).onChange((v) => (this.choice.addRequest = v)));
		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText("Apply")
					.setCta()
					.onClick(() => {
						if (!this.choice.provider) {
							new Notice("Enter a provider name.");
							return;
						}
						this.onSubmit(this.choice);
						this.close();
					})
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
