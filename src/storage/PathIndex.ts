import type {DataAdapter} from 'obsidian';
import type {PathIndexData} from '../types';

export class PathIndex {
	private data: PathIndexData;
	private basePath: string;
	private adapter: DataAdapter;

	constructor(adapter: DataAdapter, basePath: string) {
		this.adapter = adapter;
		this.basePath = basePath;
		this.data = {version: 1, mappings: {}};
	}

	async load(): Promise<void> {
		const indexPath = this.getIndexPath();
		if (await this.adapter.exists(indexPath)) {
			try {
				const raw = await this.adapter.read(indexPath);
				this.data = JSON.parse(raw) as PathIndexData;
			} catch {
				this.data = {version: 1, mappings: {}};
			}
		}
	}

	async save(): Promise<void> {
		await this.adapter.write(this.getIndexPath(), JSON.stringify(this.data, null, 2));
	}

	getCommentFileName(notePath: string): string | undefined {
		return this.data.mappings[notePath];
	}

	getOrCreateCommentFileName(notePath: string): string {
		const existing = this.data.mappings[notePath];
		if (existing) return existing;

		const fileName = notePath.replace(/\//g, '__') + '.json';
		this.data.mappings[notePath] = fileName;
		return fileName;
	}

	getCommentFilePath(notePath: string): string {
		const fileName = this.getOrCreateCommentFileName(notePath);
		return `${this.basePath}/${fileName}`;
	}

	async renamePath(oldPath: string, newPath: string): Promise<void> {
		const fileName = this.data.mappings[oldPath];
		if (!fileName) return;

		delete this.data.mappings[oldPath];
		this.data.mappings[newPath] = fileName;
		await this.save();
	}

	async deletePath(notePath: string): Promise<string | undefined> {
		const fileName = this.data.mappings[notePath];
		if (!fileName) return undefined;

		delete this.data.mappings[notePath];
		await this.save();
		return fileName;
	}

	getNotePathForFileName(fileName: string): string | undefined {
		for (const [notePath, fn] of Object.entries(this.data.mappings)) {
			if (fn === fileName) return notePath;
		}
		return undefined;
	}

	private getIndexPath(): string {
		return `${this.basePath}/_index.json`;
	}
}
