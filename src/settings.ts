import {App, Notice, PluginSettingTab, Setting} from "obsidian";
import type MarginaliaPlugin from "./main";

export interface MarginaliaSettings {
	storageLocation: 'plugin' | 'vault';
	commentSortOrder: 'position' | 'created';
	showGutterIcons: boolean;
	fuzzyMatchThreshold: number;
	orphanHandling: 'keep' | 'delete';
}

export const DEFAULT_SETTINGS: MarginaliaSettings = {
	storageLocation: 'plugin',
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
			.setName('Storage location')
			.setDesc('Where comment data is stored. After changing, use the migrate button to move existing data. Without migration, a plugin reload is needed and previous comments will not be visible.')
			.addDropdown(dropdown => dropdown
				.addOption('plugin', 'Plugin folder (comments/)')
				.addOption('vault', 'Vault root (.marginalia/)')
				.setValue(this.plugin.settings.storageLocation)
				.onChange(async (value) => {
					this.plugin.settings.storageLocation = value as 'plugin' | 'vault';
					await this.plugin.saveSettings();
				}))
			.addExtraButton(button => {
				button
					.setIcon('refresh-cw')
					.setTooltip('Migrate comment data to the selected location')
					.onClick(async () => {
						const newBasePath = this.plugin.settings.storageLocation === 'vault'
							? '.marginalia'
							: `${this.plugin.manifest.dir ?? ''}/comments`;

						if (newBasePath === this.plugin.store.currentBasePath) {
							new Notice('Comment data is already in the selected location.');
							return;
						}

						button.setDisabled(true);
						button.extraSettingsEl.addClass('marginalia-spin');

						try {
							const count = await this.plugin.store.migrateData(newBasePath);
							if (count === 0) {
								new Notice('No comment data to migrate.');
							} else {
								new Notice(`Migrated ${count} file(s) successfully.`);
							}
							this.plugin.refreshPanel();
							this.plugin.updateGutterEffects();
						} catch (e) {
							new Notice(`Migration failed: ${e instanceof Error ? e.message : String(e)}`);
						} finally {
							button.setDisabled(false);
							button.extraSettingsEl.removeClass('marginalia-spin');
						}
					});
			});

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
