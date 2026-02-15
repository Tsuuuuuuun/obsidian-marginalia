import {ItemView, MarkdownRenderer, MarkdownView, WorkspaceLeaf, TFile, setIcon} from 'obsidian';
import type SideCommentPlugin from '../main';
import type {CommentData, ResolvedAnchor} from '../types';
import {CommentModal} from './CommentModal';

export const VIEW_TYPE_COMMENT_PANEL = 'side-comment-panel';

export class CommentPanelView extends ItemView {
	private plugin: SideCommentPlugin;
	private currentFile: TFile | null = null;
	private comments: CommentData[] = [];
	private anchors: Map<string, ResolvedAnchor> = new Map();
	private filter: 'all' | 'active' | 'orphaned' = 'all';

	constructor(leaf: WorkspaceLeaf, plugin: SideCommentPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_COMMENT_PANEL;
	}

	getDisplayText(): string {
		return 'Comments';
	}

	getIcon(): string {
		return 'message-square';
	}

	async onOpen(): Promise<void> {
		this.registerEvent(
			this.plugin.app.workspace.on('active-leaf-change', () => {
				void this.updateForActiveFile();
			})
		);
		await this.updateForActiveFile();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	async refresh(): Promise<void> {
		await this.updateForActiveFile();
	}

	async updateForActiveFile(): Promise<void> {
		const file = this.plugin.app.workspace.getActiveFile();
		if (!file || file.extension !== 'md') {
			this.currentFile = null;
			this.comments = [];
			this.anchors = new Map();
			this.renderPanel();
			return;
		}

		this.currentFile = file;
		this.comments = await this.plugin.store.getComments(file.path);

		const content = await this.plugin.app.vault.read(file);
		this.anchors = await this.plugin.store.resolveAnchors(
			file.path, content, this.plugin.settings.fuzzyMatchThreshold
		);

		this.renderPanel();
	}

	scrollToComment(commentId: string): void {
		const el = this.contentEl.querySelector(`[data-comment-id="${commentId}"]`);
		if (el) {
			el.scrollIntoView({behavior: 'smooth', block: 'center'});
			el.addClass('side-comment-item-highlight');
			setTimeout(() => el.removeClass('side-comment-item-highlight'), 2000);
		}
	}

	private renderPanel(): void {
		const {contentEl} = this;
		contentEl.empty();
		contentEl.addClass('side-comment-panel');

		if (!this.currentFile) {
			contentEl.createEl('div', {
				text: 'Open a Markdown file to see comments.',
				cls: 'side-comment-empty',
			});
			return;
		}

		this.renderToolbar(contentEl);

		const filtered = this.getFilteredComments();
		if (filtered.length === 0) {
			contentEl.createEl('div', {
				text: 'No comments yet.',
				cls: 'side-comment-empty',
			});
			return;
		}

		const listEl = contentEl.createDiv({cls: 'side-comment-list'});
		for (const comment of filtered) {
			this.renderCommentItem(listEl, comment);
		}
	}

	private renderToolbar(container: HTMLElement): void {
		const toolbar = container.createDiv({cls: 'side-comment-toolbar'});

		const filterGroup = toolbar.createDiv({cls: 'side-comment-filter-group'});

		const filters: Array<{label: string; value: 'all' | 'active' | 'orphaned'}> = [
			{label: 'All', value: 'all'},
			{label: 'Active', value: 'active'},
			{label: 'Orphaned', value: 'orphaned'},
		];

		for (const f of filters) {
			const btn = filterGroup.createEl('button', {
				text: f.label,
				cls: `side-comment-filter-btn${this.filter === f.value ? ' is-active' : ''}`,
			});
			btn.addEventListener('click', () => {
				this.filter = f.value;
				this.renderPanel();
			});
		}
	}

	private getFilteredComments(): CommentData[] {
		let filtered = [...this.comments];

		if (this.filter === 'active') {
			filtered = filtered.filter(c => c.status === 'active');
		} else if (this.filter === 'orphaned') {
			filtered = filtered.filter(c => c.status === 'orphaned');
		}

		if (this.plugin.settings.commentSortOrder === 'position') {
			filtered.sort((a, b) => {
				const anchorA = this.anchors.get(a.id);
				const anchorB = this.anchors.get(b.id);
				if (!anchorA && !anchorB) return 0;
				if (!anchorA) return 1;
				if (!anchorB) return -1;
				return anchorA.from - anchorB.from;
			});
		} else {
			filtered.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
		}

		return filtered;
	}

	private renderCommentItem(container: HTMLElement, comment: CommentData): void {
		const item = container.createDiv({
			cls: `side-comment-item${comment.status === 'orphaned' ? ' side-comment-orphaned' : ''}`,
			attr: {'data-comment-id': comment.id},
		});

		// Target text quote
		const quote = item.createEl('blockquote', {
			cls: 'side-comment-quote',
		});
		const exactText = comment.target.exact.length > 100
			? comment.target.exact.substring(0, 100) + '...'
			: comment.target.exact;
		quote.createEl('span', {text: exactText});

		if (comment.status === 'orphaned') {
			quote.createEl('span', {
				text: ' (orphaned)',
				cls: 'side-comment-orphaned-badge',
			});
		}

		// Click quote to scroll editor
		quote.addEventListener('click', () => {
			this.scrollEditorToComment(comment);
		});

		// Comment body (rendered as Markdown)
		const bodyEl = item.createDiv({cls: 'side-comment-body'});
		void MarkdownRenderer.render(
			this.plugin.app,
			comment.body,
			bodyEl,
			this.currentFile?.path ?? '',
			this,
		);

		// Footer: timestamp + actions
		const footer = item.createDiv({cls: 'side-comment-footer'});

		const time = new Date(comment.createdAt);
		footer.createEl('span', {
			text: time.toLocaleString(),
			cls: 'side-comment-timestamp',
		});

		const actions = footer.createDiv({cls: 'side-comment-actions'});

		const editBtn = actions.createEl('button', {
			cls: 'side-comment-action-btn',
			attr: {'aria-label': 'Edit comment'},
		});
		setIcon(editBtn, 'pencil');
		editBtn.addEventListener('click', () => {
			this.editComment(comment);
		});

		const deleteBtn = actions.createEl('button', {
			cls: 'side-comment-action-btn',
			attr: {'aria-label': 'Delete comment'},
		});
		setIcon(deleteBtn, 'trash');
		deleteBtn.addEventListener('click', () => {
			void this.deleteComment(comment);
		});
	}

	private scrollEditorToComment(comment: CommentData): void {
		const anchor = this.anchors.get(comment.id);
		if (!anchor || !this.currentFile) return;

		const leaf = this.plugin.app.workspace.getLeaf(false);
		if (!leaf) return;

		void leaf.openFile(this.currentFile).then(() => {
			const mdView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
			if (mdView) {
				const editor = mdView.editor;
				const pos = editor.offsetToPos(anchor.from);
				editor.setCursor(pos);
				editor.scrollIntoView(
					{from: pos, to: editor.offsetToPos(anchor.to)},
					true
				);
			}
		});
	}

	private editComment(comment: CommentData): void {
		if (!this.currentFile) return;
		const filePath = this.currentFile.path;

		new CommentModal(
			this.plugin.app,
			(body) => {
				void this.plugin.store.updateComment(filePath, comment.id, body).then(() => {
					void this.refresh();
				});
			},
			comment.body
		).open();
	}

	private async deleteComment(comment: CommentData): Promise<void> {
		if (!this.currentFile) return;
		await this.plugin.store.deleteComment(this.currentFile.path, comment.id);
		await this.refresh();
		this.plugin.updateGutterEffects();
	}
}
