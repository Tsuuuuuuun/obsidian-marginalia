import {TFile} from 'obsidian';
import type MarginaliaPlugin from '../main';
import type {CommentStore} from '../storage/CommentStore';

export class VaultEventHandler {
	private plugin: MarginaliaPlugin;
	private store: CommentStore;

	constructor(plugin: MarginaliaPlugin, store: CommentStore) {
		this.plugin = plugin;
		this.store = store;
	}

	registerEvents(): void {
		this.plugin.registerEvent(
			this.plugin.app.vault.on('rename', (file, oldPath) => {
				if (!(file instanceof TFile) || file.extension !== 'md') return;
				void this.store.handleRename(oldPath, file.path);
				this.plugin.refreshPanel();
			})
		);

		this.plugin.registerEvent(
			this.plugin.app.vault.on('delete', (file) => {
				if (!(file instanceof TFile) || file.extension !== 'md') return;
				const shouldDelete = this.plugin.settings.orphanHandling === 'delete';
				void this.store.handleDelete(file.path, shouldDelete);
				this.plugin.refreshPanel();
			})
		);
	}
}
