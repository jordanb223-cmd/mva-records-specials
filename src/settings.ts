import { App, PluginSettingTab, Setting } from "obsidian";
import type MvaPlugin from "./main";
import { DEFAULT_SETTINGS } from "./types";

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
