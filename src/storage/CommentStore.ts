import type {DataAdapter} from 'obsidian';
import type {CommentData, CommentFile, CommentTarget, CommentThread, ReplyComment, ResolvedAnchor, RootComment} from '../types';
import {isRootComment, isReplyComment} from '../types';
import {PathIndex} from './PathIndex';

export class CommentStore {
	private adapter: DataAdapter;
	private basePath: string;
	pathIndex: PathIndex;
	private cache: Map<string, CommentFile> = new Map();
	private writeTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
	private resolveAnchorFn: ((target: CommentTarget, docText: string, threshold: number) => ResolvedAnchor | null) | null = null;

	constructor(adapter: DataAdapter, pluginDir: string) {
		this.adapter = adapter;
		this.basePath = `${pluginDir}/comments`;
		this.pathIndex = new PathIndex(adapter, this.basePath);
	}

	setAnchorResolver(fn: (target: CommentTarget, docText: string, threshold: number) => ResolvedAnchor | null): void {
		this.resolveAnchorFn = fn;
	}

	async initialize(): Promise<void> {
		if (!(await this.adapter.exists(this.basePath))) {
			await this.adapter.mkdir(this.basePath);
		}
		await this.pathIndex.load();
	}

	async getComments(notePath: string): Promise<CommentData[]> {
		const file = await this.loadCommentFile(notePath);
		if (!file) return [];
		return file.comments;
	}

	async addComment(notePath: string, body: string, target: CommentTarget): Promise<RootComment> {
		const file = await this.getOrCreateCommentFile(notePath);
		const now = new Date().toISOString();
		const comment: RootComment = {
			id: generateId(),
			body,
			target,
			status: 'active',
			createdAt: now,
			updatedAt: now,
		};
		file.comments.push(comment);
		this.scheduleSave(notePath);
		return comment;
	}

	async addReply(notePath: string, parentId: string, body: string): Promise<ReplyComment | null> {
		const file = await this.loadCommentFile(notePath);
		if (!file) return null;

		const parent = file.comments.find(c => c.id === parentId);
		if (!parent || !isRootComment(parent)) return null;

		const now = new Date().toISOString();
		const reply: ReplyComment = {
			id: generateId(),
			parentId,
			body,
			createdAt: now,
			updatedAt: now,
		};
		file.comments.push(reply);
		this.scheduleSave(notePath);
		return reply;
	}

	async updateComment(notePath: string, commentId: string, body: string): Promise<CommentData | null> {
		const file = await this.loadCommentFile(notePath);
		if (!file) return null;

		const comment = file.comments.find(c => c.id === commentId);
		if (!comment) return null;

		comment.body = body;
		comment.updatedAt = new Date().toISOString();
		this.scheduleSave(notePath);
		return comment;
	}

	async deleteComment(notePath: string, commentId: string): Promise<boolean> {
		const file = await this.loadCommentFile(notePath);
		if (!file) return false;

		const idx = file.comments.findIndex(c => c.id === commentId);
		if (idx === -1) return false;

		const target = file.comments[idx]!;

		if (isRootComment(target)) {
			// Cascade delete: remove all replies to this root comment
			file.comments = file.comments.filter(
				c => c.id === commentId ? false : !(isReplyComment(c) && c.parentId === commentId)
			);
		} else {
			file.comments.splice(idx, 1);
		}

		this.scheduleSave(notePath);
		return true;
	}

	getThreads(comments: CommentData[]): CommentThread[] {
		const replyMap = new Map<string, ReplyComment[]>();
		const roots: RootComment[] = [];

		for (const c of comments) {
			if (isRootComment(c)) {
				roots.push(c);
			} else {
				const existing = replyMap.get(c.parentId);
				if (existing) {
					existing.push(c);
				} else {
					replyMap.set(c.parentId, [c]);
				}
			}
		}

		// Warn about orphaned replies (parent not found)
		for (const [parentId] of replyMap) {
			if (!roots.some(r => r.id === parentId)) {
				console.warn(`[side-comment] Reply references non-existent parent: ${parentId}`);
			}
		}

		const threads: CommentThread[] = [];
		for (const root of roots) {
			const replies = replyMap.get(root.id) ?? [];
			replies.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
			threads.push({root, replies});
		}

		return threads;
	}

	async resolveAnchors(notePath: string, docText: string, threshold: number): Promise<Map<string, ResolvedAnchor>> {
		const results = new Map<string, ResolvedAnchor>();
		if (!this.resolveAnchorFn) return results;

		const comments = await this.getComments(notePath);
		let changed = false;

		for (const comment of comments) {
			if (!isRootComment(comment)) continue;

			const anchor = this.resolveAnchorFn(comment.target, docText, threshold);
			if (anchor) {
				results.set(comment.id, anchor);
				if (comment.status === 'orphaned') {
					comment.status = 'active';
					comment.target.lineHint = anchor.line;
					changed = true;
				} else if (comment.target.lineHint !== anchor.line) {
					comment.target.lineHint = anchor.line;
					changed = true;
				}
			} else if (comment.status === 'active') {
				comment.status = 'orphaned';
				changed = true;
			}
		}

		if (changed) {
			this.scheduleSave(notePath);
		}
		return results;
	}

	async handleRename(oldPath: string, newPath: string): Promise<void> {
		await this.pathIndex.renamePath(oldPath, newPath);

		const cached = this.cache.get(oldPath);
		if (cached) {
			cached.sourceFile = newPath;
			this.cache.delete(oldPath);
			this.cache.set(newPath, cached);
			this.scheduleSave(newPath);
		}
	}

	async handleDelete(notePath: string, shouldDelete: boolean): Promise<void> {
		const fileName = await this.pathIndex.deletePath(notePath);
		this.cache.delete(notePath);

		if (shouldDelete && fileName) {
			const filePath = `${this.basePath}/${fileName}`;
			if (await this.adapter.exists(filePath)) {
				await this.adapter.remove(filePath);
			}
		}
	}

	async flushAll(): Promise<void> {
		for (const [, timer] of this.writeTimers) {
			clearTimeout(timer);
		}
		this.writeTimers.clear();

		const saves: Promise<void>[] = [];
		for (const [notePath] of this.cache) {
			saves.push(this.saveCommentFile(notePath));
		}
		await Promise.all(saves);
	}

	private async loadCommentFile(notePath: string): Promise<CommentFile | null> {
		const cached = this.cache.get(notePath);
		if (cached) return cached;

		const fileName = this.pathIndex.getCommentFileName(notePath);
		if (!fileName) return null;

		const filePath = `${this.basePath}/${fileName}`;
		if (!(await this.adapter.exists(filePath))) return null;

		try {
			const raw = await this.adapter.read(filePath);
			const file = JSON.parse(raw) as CommentFile;
			this.cache.set(notePath, file);
			return file;
		} catch {
			return null;
		}
	}

	private async getOrCreateCommentFile(notePath: string): Promise<CommentFile> {
		const existing = await this.loadCommentFile(notePath);
		if (existing) return existing;

		this.pathIndex.getOrCreateCommentFileName(notePath);
		await this.pathIndex.save();

		const file: CommentFile = {
			version: 1,
			sourceFile: notePath,
			comments: [],
		};
		this.cache.set(notePath, file);
		return file;
	}

	private scheduleSave(notePath: string): void {
		const existing = this.writeTimers.get(notePath);
		if (existing) clearTimeout(existing);

		const timer = setTimeout(() => {
			this.writeTimers.delete(notePath);
			void this.saveCommentFile(notePath);
		}, 500);
		this.writeTimers.set(notePath, timer);
	}

	private async saveCommentFile(notePath: string): Promise<void> {
		const file = this.cache.get(notePath);
		if (!file) return;

		const fileName = this.pathIndex.getCommentFileName(notePath);
		if (!fileName) return;

		const filePath = `${this.basePath}/${fileName}`;
		await this.adapter.write(filePath, JSON.stringify(file, null, 2));
	}
}

function generateId(): string {
	const bytes = new Uint8Array(4);
	crypto.getRandomValues(bytes);
	return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
