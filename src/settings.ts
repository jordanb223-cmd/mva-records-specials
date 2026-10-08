import { App, PluginSettingTab, Setting } from "obsidian";
import type MvaPlugin from "./main";
import { DEFAULT_SETTINGS, MvaSettings } from "./types";

/*
 * Minimal shapes of the declarative settings API (Obsidian 1.13+), declared here so the plugin
 * still builds against older typings. On 1.13+ Obsidian draws the tab from getSettingDefinitions()
 * and indexes it for settings search, reading and saving through getControlValue/setControlValue.
 * Older versions ignore these and call display() instead.
 */
type Control =
	| { type: "text" | "textarea"; key: string; placeholder?: string; rows?: number }
	| { type: "number"; key: string; min?: number }
	| { type: "dropdown"; key: string; options: Record<string, string> };
interface Definition {
	name: string;
	desc?: string;
	aliases?: string[];
	control?: Control;
	action?: (el: HTMLElement, index: number) => void;
}
interface DefinitionGroup {
	type: "group";
	heading?: string;
	items: Definition[];
}

/** Settings stored as lists but edited as one item per line. */
const LIST_KEYS = ["recordTypes", "requestMethods", "deliveryMethods", "enclosureTypes"] as const;
type ListKey = (typeof LIST_KEYS)[number];
const isListKey = (k: string): k is ListKey => (LIST_KEYS as readonly string[]).includes(k);

function toList(value: string): string[] {
	return value
		.split("\n")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

export class MvaSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: MvaPlugin) {
		super(app, plugin);
	}

	getSettingDefinitions(): (Definition | DefinitionGroup)[] {
		return [
			{
				name: "Default follow-up (days)",
				desc: "Days after the request date for the follow-up reminder.",
				aliases: ["follow up", "reminder", "days"],
				control: { type: "number", key: "followUpDays", min: 1 },
			},
			{ name: "Currency", desc: "Three-letter currency code used to format amounts.", control: { type: "text", key: "currency" } },
			{ name: "Playbook folder", desc: "Each note in this folder is a playbook.", control: { type: "text", key: "playbookFolder" } },
			{ name: "Create sample playbooks", action: () => void this.plugin.createSamples() },
			{
				type: "group",
				heading: "Reports and packets",
				items: [
					{ name: "Firm name", desc: "Printed at the top of reports and packets.", aliases: ["letterhead", "law office"], control: { type: "text", key: "firmName" } },
					{ name: "Prepared by", desc: "Your name and title, as it should appear on reports.", aliases: ["paralegal", "author"], control: { type: "text", key: "preparedBy" } },
					{ name: "Page size", aliases: ["paper", "letter", "a4"], control: { type: "dropdown", key: "pageSize", options: { letter: "Letter", a4: "A4" } } },
					{ name: "Case files folder", desc: "Where uploads and generated PDFs go. {case} is replaced by the note's name.", aliases: ["attachments", "uploads"], control: { type: "text", key: "caseFilesFolder" } },
				],
			},
			{
				type: "group",
				heading: "Lists",
				items: [
					{ name: "Record types", desc: "One per line.", control: { type: "textarea", key: "recordTypes", rows: 7 } },
					{ name: "Enclosures", desc: "One per line.", control: { type: "textarea", key: "enclosureTypes", rows: 6 } },
					{ name: "Return methods", desc: "One per line.", control: { type: "textarea", key: "deliveryMethods", rows: 6 } },
					{ name: "Request methods", desc: "One per line.", control: { type: "textarea", key: "requestMethods", rows: 7 } },
				],
			},
		];
	}

	getControlValue(key: string): unknown {
		const s = this.plugin.settings;
		if (isListKey(key)) return s[key].join("\n");
		return (s as unknown as Record<string, unknown>)[key];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const s: MvaSettings = this.plugin.settings;
		if (isListKey(key)) s[key] = toList(typeof value === "string" ? value : "");
		else if (key === "followUpDays") {
			const n = typeof value === "number" ? value : parseInt(String(value), 10);
			s.followUpDays = isFinite(n) && n > 0 ? n : DEFAULT_SETTINGS.followUpDays;
		} else if (key === "pageSize") s.pageSize = value === "a4" ? "a4" : "letter";
		else if (key === "currency" || key === "playbookFolder" || key === "firmName" || key === "preparedBy" || key === "caseFilesFolder") {
			const text = typeof value === "string" ? value.trim() : "";
			s[key] = key === "currency" ? text.toUpperCase() || DEFAULT_SETTINGS.currency : text || (key === "playbookFolder" || key === "caseFilesFolder" ? DEFAULT_SETTINGS[key] : "");
		}
		await this.plugin.saveSettings();
	}

	display(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Default follow-up (days)")
			.setDesc("New requests get a follow-up date this many days after the request date. Logging a follow-up pushes it out by the same amount.")
			.addText((t) => {
				t.inputEl.type = "number";
				t.inputEl.min = "1";
				t.setValue(String(s.followUpDays)).onChange(async (v) => {
					const n = parseInt(v, 10);
					s.followUpDays = isFinite(n) && n > 0 ? n : DEFAULT_SETTINGS.followUpDays;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Currency")
			.setDesc("Three-letter currency code used to format amounts.")
			.addText((t) =>
				t.setValue(s.currency).onChange(async (v) => {
					s.currency = v.trim().toUpperCase() || DEFAULT_SETTINGS.currency;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Playbook folder")
			.setDesc("Each note in this folder is a playbook. Its task list becomes the checklist.")
			.addText((t) =>
				t.setValue(s.playbookFolder).onChange(async (v) => {
					s.playbookFolder = v.trim() || DEFAULT_SETTINGS.playbookFolder;
					await this.plugin.saveSettings();
				})
			)
			.addButton((b) => b.setButtonText("Create samples").onClick(() => void this.plugin.createSamples()));

		new Setting(containerEl).setName("Reports and packets").setHeading();

		new Setting(containerEl)
			.setName("Firm name")
			.setDesc("Printed at the top of reports and packets.")
			.addText((t) =>
				t.setValue(s.firmName).onChange(async (v) => {
					s.firmName = v.trim();
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Prepared by")
			.setDesc("Your name and title, as it should appear on reports.")
			.addText((t) =>
				t.setValue(s.preparedBy).onChange(async (v) => {
					s.preparedBy = v.trim();
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl).setName("Page size").addDropdown((d) =>
			d
				.addOption("letter", "Letter")
				.addOption("a4", "A4")
				.setValue(s.pageSize)
				.onChange(async (v) => {
					s.pageSize = v === "a4" ? "a4" : "letter";
					await this.plugin.saveSettings();
				})
		);

		new Setting(containerEl)
			.setName("Case files folder")
			.setDesc("Where uploads and generated PDFs go, next to the case note. {case} is replaced by the note's name.")
			.addText((t) =>
				t.setValue(s.caseFilesFolder).onChange(async (v) => {
					s.caseFilesFolder = v.trim() || DEFAULT_SETTINGS.caseFilesFolder;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl).setName("Lists").setHeading();

		new Setting(containerEl)
			.setName("Record types")
			.setDesc("One per line. Shown in the request form.")
			.addTextArea((t) => {
				t.inputEl.rows = 7;
				t.setValue(s.recordTypes.join("\n")).onChange(async (v) => {
					s.recordTypes = toList(v);
					await this.plugin.saveSettings();
				});
			});

		this.listSetting("Enclosures", "One per line. Shown as checkboxes in the request form.", s.enclosureTypes, (v) => (s.enclosureTypes = v));
		this.listSetting("Return methods", "One per line. How a provider can send records back.", s.deliveryMethods, (v) => (s.deliveryMethods = v));

		new Setting(containerEl)
			.setName("Request methods")
			.setDesc("One per line. Shown in the request form.")
			.addTextArea((t) => {
				t.inputEl.rows = 7;
				t.setValue(s.requestMethods.join("\n")).onChange(async (v) => {
					s.requestMethods = toList(v);
					await this.plugin.saveSettings();
				});
			});

		this.supportFooter();
	}

	private supportFooter(): void {
		const foot = this.containerEl.createDiv({ cls: "mva-support" });
		foot.appendText("Find this useful? ");
		foot.createEl("a", { text: "Buy me a coffee", href: "https://buymeacoffee.com/jordanb223" });
		foot.appendText(".");
	}

	private listSetting(name: string, desc: string, value: string[], set: (v: string[]) => void): void {
		new Setting(this.containerEl)
			.setName(name)
			.setDesc(desc)
			.addTextArea((t) => {
				t.inputEl.rows = 6;
				t.setValue(value.join("\n")).onChange(async (v) => {
					set(toList(v));
					await this.plugin.saveSettings();
				});
			});
	}
}
