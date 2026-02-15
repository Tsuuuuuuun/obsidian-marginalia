import {ItemView, MarkdownRenderer, MarkdownView, WorkspaceLeaf, TFile, setIcon} from 'obsidian';
import type SideCommentPlugin from '../main';
import type {AnchoredComment, CommentData, CommentThread, NoteComment, PanelData, ReplyComment, ResolvedAnchor} from '../types';
import {isReplyComment, isNoteComment} from '../types';
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
		// If the commentId is a reply, find its parent thread element
		const reply = this.comments.find(c => c.id === commentId && isReplyComment(c));
		const targetId = reply && isReplyComment(reply) ? reply.parentId : commentId;

		const el = this.contentEl.querySelector(`[data-comment-id="${targetId}"]`);
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

		const {noteComments, threads} = this.getFilteredPanelData();

		if (noteComments.length === 0 && threads.length === 0) {
			contentEl.createEl('div', {
				text: 'No comments yet.',
				cls: 'side-comment-empty',
			});
			return;
		}

		const listEl = contentEl.createDiv({cls: 'side-comment-list'});

		if (noteComments.length > 0) {
			const noteSection = listEl.createDiv({cls: 'side-comment-note-section'});
			const header = noteSection.createDiv({cls: 'side-comment-section-header'});
			setIcon(header.createSpan(), 'sticky-note');
			header.createSpan({text: 'Note comments'});
			for (const nc of noteComments) {
				this.renderNoteComment(noteSection, nc);
			}
		}

		if (threads.length > 0) {
			if (noteComments.length > 0) {
				const anchoredHeader = listEl.createDiv({cls: 'side-comment-section-header'});
				setIcon(anchoredHeader.createSpan(), 'message-square');
				anchoredHeader.createSpan({text: 'Anchored comments'});
			}
			for (const thread of threads) {
				this.renderThread(listEl, thread);
			}
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

		// Add note comment button
		const addBtn = toolbar.createEl('button', {
			cls: 'side-comment-add-btn clickable-icon',
			attr: {'aria-label': 'Add note comment'},
		});
		setIcon(addBtn, 'plus');
		addBtn.addEventListener('click', () => {
			this.addNoteComment();
		});
	}

	private addNoteComment(): void {
		if (!this.currentFile) return;
		const filePath = this.currentFile.path;

		new CommentModal(
			this.plugin.app,
			(body) => {
				void this.plugin.store.addNoteComment(filePath, body).then(() => {
					void this.refresh();
				});
			},
			undefined,
			'Add note comment'
		).open();
	}

	private getFilteredPanelData(): PanelData {
		const panelData = this.plugin.store.getPanelData(this.comments);
		let {noteComments} = panelData;
		let {threads} = panelData;

		if (this.filter === 'active') {
			threads = threads.filter(t => t.root.status === 'active');
			// NoteComment always visible in "active" filter
		} else if (this.filter === 'orphaned') {
			threads = threads.filter(t => t.root.status === 'orphaned');
			// NoteComment hidden in "orphaned" filter (they can't be orphaned)
			noteComments = [];
		}

		if (this.plugin.settings.commentSortOrder === 'position') {
			threads.sort((a, b) => {
				const anchorA = this.anchors.get(a.root.id);
				const anchorB = this.anchors.get(b.root.id);
				if (!anchorA && !anchorB) return 0;
				if (!anchorA) return 1;
				if (!anchorB) return -1;
				return anchorA.from - anchorB.from;
			});
		} else {
			threads.sort((a, b) => a.root.createdAt.localeCompare(b.root.createdAt));
		}

		return {noteComments, threads};
	}

	private renderNoteComment(container: HTMLElement, nc: NoteComment): void {
		const item = container.createDiv({
			cls: 'side-comment-note-item',
			attr: {'data-comment-id': nc.id},
		});

		// Note label
		const label = item.createDiv({cls: 'side-comment-note-label'});
		setIcon(label.createSpan(), 'sticky-note');
		label.createSpan({text: 'Note'});

		// Comment body (rendered as Markdown)
		const bodyEl = item.createDiv({cls: 'side-comment-body'});
		void MarkdownRenderer.render(
			this.plugin.app,
			nc.body,
			bodyEl,
			this.currentFile?.path ?? '',
			this,
		);

		// Footer: timestamp + actions
		const footer = item.createDiv({cls: 'side-comment-footer'});

		const time = new Date(nc.createdAt);
		footer.createEl('span', {
			text: time.toLocaleString(),
			cls: 'side-comment-timestamp',
		});

		const actions = footer.createDiv({cls: 'side-comment-actions'});

		const editBtn = actions.createEl('button', {
			cls: 'side-comment-action-btn clickable-icon',
			attr: {'aria-label': 'Edit comment'},
		});
		setIcon(editBtn, 'pencil');
		editBtn.addEventListener('click', () => {
			this.editComment(nc);
		});

		const deleteBtn = actions.createEl('button', {
			cls: 'side-comment-action-btn clickable-icon',
			attr: {'aria-label': 'Delete comment'},
		});
		setIcon(deleteBtn, 'trash');
		deleteBtn.addEventListener('click', () => {
			void this.deleteComment(nc);
		});
	}

	private renderThread(container: HTMLElement, thread: CommentThread): void {
		const threadEl = container.createDiv({
			cls: `side-comment-thread${thread.root.status === 'orphaned' ? ' side-comment-orphaned' : ''}`,
			attr: {'data-comment-id': thread.root.id},
		});

		this.renderRootComment(threadEl, thread.root, thread.replies.length);

		if (thread.replies.length > 0) {
			const repliesEl = threadEl.createDiv({cls: 'side-comment-replies'});
			for (const reply of thread.replies) {
				this.renderReply(repliesEl, reply);
			}
		}
	}

	private renderRootComment(container: HTMLElement, root: AnchoredComment, replyCount: number): void {
		const item = container.createDiv({cls: 'side-comment-item'});

		// Target text quote
		const quote = item.createEl('blockquote', {
			cls: 'side-comment-quote',
		});
		const exactText = root.target.exact.length > 100
			? root.target.exact.substring(0, 100) + '...'
			: root.target.exact;
		quote.createEl('span', {text: exactText});

		if (root.status === 'orphaned') {
			quote.createEl('span', {
				text: ' (orphaned)',
				cls: 'side-comment-orphaned-badge',
			});
		}

		// Click quote to scroll editor
		quote.addEventListener('click', () => {
			this.scrollEditorToComment(root);
		});

		// Comment body (rendered as Markdown)
		const bodyEl = item.createDiv({cls: 'side-comment-body'});
		void MarkdownRenderer.render(
			this.plugin.app,
			root.body,
			bodyEl,
			this.currentFile?.path ?? '',
			this,
		);

		// Footer: timestamp + actions
		const footer = item.createDiv({cls: 'side-comment-footer'});

		const time = new Date(root.createdAt);
		footer.createEl('span', {
			text: time.toLocaleString(),
			cls: 'side-comment-timestamp',
		});

		const actions = footer.createDiv({cls: 'side-comment-actions'});

		const replyBtn = actions.createEl('button', {
			cls: 'side-comment-action-btn clickable-icon',
			attr: {'aria-label': `Reply (${replyCount})`},
		});
		setIcon(replyBtn, 'message-circle');
		if (replyCount > 0) {
			replyBtn.createEl('span', {
				text: String(replyCount),
				cls: 'side-comment-reply-count-badge',
			});
		}
		replyBtn.addEventListener('click', () => {
			this.addReply(root);
		});

		const editBtn = actions.createEl('button', {
			cls: 'side-comment-action-btn clickable-icon',
			attr: {'aria-label': 'Edit comment'},
		});
		setIcon(editBtn, 'pencil');
		editBtn.addEventListener('click', () => {
			this.editComment(root);
		});

		const deleteBtn = actions.createEl('button', {
			cls: 'side-comment-action-btn clickable-icon',
			attr: {'aria-label': 'Delete comment'},
		});
		setIcon(deleteBtn, 'trash');
		deleteBtn.addEventListener('click', () => {
			void this.deleteComment(root);
		});
	}

	private renderReply(container: HTMLElement, reply: ReplyComment): void {
		const item = container.createDiv({
			cls: 'side-comment-reply',
			attr: {'data-reply-id': reply.id},
		});

		// Reply body (rendered as Markdown)
		const bodyEl = item.createDiv({cls: 'side-comment-body'});
		void MarkdownRenderer.render(
			this.plugin.app,
			reply.body,
			bodyEl,
			this.currentFile?.path ?? '',
			this,
		);

		// Footer: timestamp + actions
		const footer = item.createDiv({cls: 'side-comment-footer'});

		const time = new Date(reply.createdAt);
		footer.createEl('span', {
			text: time.toLocaleString(),
			cls: 'side-comment-timestamp',
		});

		const actions = footer.createDiv({cls: 'side-comment-actions'});

		const editBtn = actions.createEl('button', {
			cls: 'side-comment-action-btn clickable-icon',
			attr: {'aria-label': 'Edit reply'},
		});
		setIcon(editBtn, 'pencil');
		editBtn.addEventListener('click', () => {
			this.editComment(reply);
		});

		const deleteBtn = actions.createEl('button', {
			cls: 'side-comment-action-btn clickable-icon',
			attr: {'aria-label': 'Delete reply'},
		});
		setIcon(deleteBtn, 'trash');
		deleteBtn.addEventListener('click', () => {
			void this.deleteComment(reply);
		});
	}

	private scrollEditorToComment(root: AnchoredComment): void {
		const anchor = this.anchors.get(root.id);
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

	private addReply(root: AnchoredComment): void {
		if (!this.currentFile) return;
		const filePath = this.currentFile.path;

		new CommentModal(
			this.plugin.app,
			(body) => {
				void this.plugin.store.addReply(filePath, root.id, body).then(() => {
					void this.refresh();
				});
			},
			undefined,
			'Add reply'
		).open();
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
		if (!isNoteComment(comment)) {
			this.plugin.updateGutterEffects();
		}
	}
}
