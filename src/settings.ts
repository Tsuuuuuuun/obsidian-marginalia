import {App, PluginSettingTab, Setting} from "obsidian";
import type MarginaliaPlugin from "./main";

export interface MarginaliaSettings {
	commentSortOrder: 'position' | 'created';
	showGutterIcons: boolean;
	fuzzyMatchThreshold: number;
	orphanHandling: 'keep' | 'delete';
}

export const DEFAULT_SETTINGS: MarginaliaSettings = {
	commentSortOrder: 'position',
	showGutterIcons: true,
	fuzzyMatchThreshold: 0.3,
	orphanHandling: 'keep',
};

export class MarginaliaSettingTab extends PluginSettingTab {
	plugin: MarginaliaPlugin;

	constructor(app: App, plugin: MarginaliaPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Comment sort order')
			.setDesc('How comments are sorted in the side panel.')
			.addDropdown(dropdown => dropdown
				.addOption('position', 'Position in file')
				.addOption('created', 'Creation date')
				.setValue(this.plugin.settings.commentSortOrder)
				.onChange(async (value) => {
					this.plugin.settings.commentSortOrder = value as 'position' | 'created';
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Show gutter icons')
			.setDesc('Display comment icons in the editor gutter.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showGutterIcons)
				.onChange(async (value) => {
					this.plugin.settings.showGutterIcons = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Fuzzy match threshold')
			.setDesc('Maximum edit distance ratio (0.0-1.0) for fuzzy anchor matching. Lower values are stricter.')
			.addSlider(slider => slider
				.setLimits(0.1, 0.5, 0.05)
				.setValue(this.plugin.settings.fuzzyMatchThreshold)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.fuzzyMatchThreshold = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Orphaned comment handling')
			.setDesc('What to do when a comment can no longer find its target text.')
			.addDropdown(dropdown => dropdown
				.addOption('keep', 'Keep and notify')
				.addOption('delete', 'Delete automatically')
				.setValue(this.plugin.settings.orphanHandling)
				.onChange(async (value) => {
					this.plugin.settings.orphanHandling = value as 'keep' | 'delete';
					await this.plugin.saveSettings();
				}));
	}
}
