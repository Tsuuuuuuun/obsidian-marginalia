import {ItemView, MarkdownRenderer, MarkdownView, Menu, WorkspaceLeaf, TFile, setIcon} from 'obsidian';
import type MarginaliaPlugin from '../main';
import type {AnchoredComment, CommentData, CommentThread, NoteComment, PanelData, ReplyComment, RootComment, ResolvedAnchor} from '../types';
import {isReplyComment, isNoteComment, getRootResolution} from '../types';
import {getPanelData, filterPanelData} from '../comment/threading';
import {CommentModal} from './CommentModal';

export const VIEW_TYPE_COMMENT_PANEL = 'marginalia-panel';

export class CommentPanelView extends ItemView {
	private plugin: MarginaliaPlugin;
	private currentFile: TFile | null = null;
	private comments: CommentData[] = [];
	private anchors: Map<string, ResolvedAnchor> = new Map();
	private filter: 'all' | 'open' | 'resolved' | 'active' | 'orphaned' = 'all';

	constructor(leaf: WorkspaceLeaf, plugin: MarginaliaPlugin) {
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

		// Handle internal wiki-link clicks in rendered Markdown
		this.registerDomEvent(this.contentEl, 'click', (evt: MouseEvent) => {
			const target = evt.target as HTMLElement;
			const link = target.closest('a.internal-link');
			if (link instanceof HTMLAnchorElement) {
				evt.preventDefault();
				const href = link.dataset.href;
				if (href) {
					void this.plugin.app.workspace.openLinkText(
						href,
						this.currentFile?.path ?? '',
						evt.ctrlKey || evt.metaKey,
					);
				}
			}
		});

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
			el.addClass('marginalia-item-highlight');
			setTimeout(() => el.removeClass('marginalia-item-highlight'), 2000);
		}
	}

	private renderPanel(): void {
		const {contentEl} = this;
		contentEl.empty();
		contentEl.addClass('marginalia-panel');

		if (!this.currentFile) {
			contentEl.createEl('div', {
				text: 'Open a Markdown file to see comments.',
				cls: 'marginalia-empty',
			});
			return;
		}

		this.renderToolbar(contentEl);

		const {noteComments, threads} = this.getFilteredPanelData();

		if (noteComments.length === 0 && threads.length === 0) {
			contentEl.createEl('div', {
				text: 'No comments yet.',
				cls: 'marginalia-empty',
			});
			return;
		}

		const listEl = contentEl.createDiv({cls: 'marginalia-list'});

		if (noteComments.length > 0) {
			const noteSection = listEl.createDiv({cls: 'marginalia-note-section'});
			const header = noteSection.createDiv({cls: 'marginalia-section-header'});
			setIcon(header.createSpan(), 'sticky-note');
			header.createSpan({text: 'Note comments'});
			for (const nc of noteComments) {
				this.renderNoteComment(noteSection, nc);
			}
		}

		if (threads.length > 0) {
			if (noteComments.length > 0) {
				const anchoredHeader = listEl.createDiv({cls: 'marginalia-section-header'});
				setIcon(anchoredHeader.createSpan(), 'message-square');
				anchoredHeader.createSpan({text: 'Anchored comments'});
			}
			for (const thread of threads) {
				this.renderThread(listEl, thread);
			}
		}
	}

	private renderToolbar(container: HTMLElement): void {
		const toolbar = container.createDiv({cls: 'marginalia-toolbar'});

		const filterGroup = toolbar.createDiv({cls: 'marginalia-filter-group'});

		type FilterValue = typeof this.filter;
		const primaryFilters: Array<{label: string; value: FilterValue}> = [
			{label: 'All', value: 'all'},
			{label: 'Open', value: 'open'},
			{label: 'Resolved', value: 'resolved'},
		];

		const overflowFilters: Array<{label: string; value: FilterValue}> = [
			{label: 'Active', value: 'active'},
			{label: 'Orphaned', value: 'orphaned'},
		];

		for (const f of primaryFilters) {
			const btn = filterGroup.createEl('button', {
				text: f.label,
				cls: `marginalia-filter-btn${this.filter === f.value ? ' is-active' : ''}`,
			});
			btn.addEventListener('click', () => {
				this.filter = f.value;
				this.renderPanel();
			});
		}

		// Overflow menu button for Active / Orphaned filters
		const isOverflowActive = overflowFilters.some(f => f.value === this.filter);
		const moreBtn = filterGroup.createEl('button', {
			cls: `marginalia-more-btn clickable-icon${isOverflowActive ? ' is-active' : ''}`,
			attr: {'aria-label': 'More filters'},
		});
		setIcon(moreBtn, 'more-horizontal');
		moreBtn.addEventListener('click', () => {
			const menu = new Menu();
			for (const f of overflowFilters) {
				menu.addItem(item => {
					item.setTitle(f.label)
						.setChecked(this.filter === f.value)
						.onClick(() => {
							this.filter = f.value;
							this.renderPanel();
						});
				});
			}
			menu.showAtMouseEvent(new MouseEvent('click', {
				clientX: moreBtn.getBoundingClientRect().left,
				clientY: moreBtn.getBoundingClientRect().bottom,
			}));
		});

		// Add note comment button
		const addBtn = toolbar.createEl('button', {
			cls: 'marginalia-add-btn clickable-icon',
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
		const panelData = getPanelData(this.comments);
		return filterPanelData(panelData, this.filter, this.plugin.settings.commentSortOrder, this.anchors);
	}

	private renderNoteComment(container: HTMLElement, nc: NoteComment): void {
		const resolved = getRootResolution(nc) === 'resolved';
		const item = container.createDiv({
			cls: `marginalia-note-item${resolved ? ' marginalia-resolved' : ''}`,
			attr: {'data-comment-id': nc.id},
		});

		// Note label
		const label = item.createDiv({cls: 'marginalia-note-label'});
		setIcon(label.createSpan(), 'sticky-note');
		label.createSpan({text: 'Note'});
		if (resolved) {
			label.createSpan({text: ' (resolved)', cls: 'marginalia-resolved-badge'});
		}

		// Comment body (rendered as Markdown)
		const bodyEl = item.createDiv({cls: 'marginalia-body'});
		void MarkdownRenderer.render(
			this.plugin.app,
			nc.body,
			bodyEl,
			this.currentFile?.path ?? '',
			this,
		);

		// Footer: timestamp + actions
		const footer = item.createDiv({cls: 'marginalia-footer'});

		const time = new Date(nc.createdAt);
		footer.createEl('span', {
			text: time.toLocaleString(),
			cls: 'marginalia-timestamp',
		});

		const actions = footer.createDiv({cls: 'marginalia-actions'});

		const resolveBtn = actions.createEl('button', {
			cls: 'marginalia-action-btn clickable-icon',
			attr: {'aria-label': resolved ? 'Unresolve' : 'Resolve'},
		});
		setIcon(resolveBtn, resolved ? 'circle' : 'check-circle');
		resolveBtn.addEventListener('click', () => {
			void this.toggleResolution(nc);
		});

		const editBtn = actions.createEl('button', {
			cls: 'marginalia-action-btn clickable-icon',
			attr: {'aria-label': 'Edit comment'},
		});
		setIcon(editBtn, 'pencil');
		editBtn.addEventListener('click', () => {
			this.editComment(nc);
		});

		const deleteBtn = actions.createEl('button', {
			cls: 'marginalia-action-btn clickable-icon',
			attr: {'aria-label': 'Delete comment'},
		});
		setIcon(deleteBtn, 'trash');
		deleteBtn.addEventListener('click', () => {
			void this.deleteComment(nc);
		});
	}

	private renderThread(container: HTMLElement, thread: CommentThread): void {
		const resolved = getRootResolution(thread.root) === 'resolved';
		let cls = 'marginalia-thread';
		if (thread.root.status === 'orphaned') cls += ' marginalia-orphaned';
		if (resolved) cls += ' marginalia-resolved';
		const threadEl = container.createDiv({
			cls,
			attr: {'data-comment-id': thread.root.id},
		});

		this.renderRootComment(threadEl, thread.root, thread.replies.length);

		if (thread.replies.length > 0) {
			const repliesEl = threadEl.createDiv({cls: 'marginalia-replies'});
			for (const reply of thread.replies) {
				this.renderReply(repliesEl, reply);
			}
		}
	}

	private renderRootComment(container: HTMLElement, root: AnchoredComment, replyCount: number): void {
		const resolved = getRootResolution(root) === 'resolved';
		const item = container.createDiv({cls: 'marginalia-item'});

		// Target text quote
		const quote = item.createEl('blockquote', {
			cls: 'marginalia-quote',
		});
		const exactText = root.target.exact.length > 100
			? root.target.exact.substring(0, 100) + '...'
			: root.target.exact;
		quote.createEl('span', {text: exactText});

		if (root.status === 'orphaned') {
			quote.createEl('span', {
				text: ' (orphaned)',
				cls: 'marginalia-orphaned-badge',
			});
		}
		if (resolved) {
			quote.createEl('span', {
				text: ' (resolved)',
				cls: 'marginalia-resolved-badge',
			});
		}

		// Click quote to scroll editor
		quote.addEventListener('click', () => {
			this.scrollEditorToComment(root);
		});

		// Comment body (rendered as Markdown)
		const bodyEl = item.createDiv({cls: 'marginalia-body'});
		void MarkdownRenderer.render(
			this.plugin.app,
			root.body,
			bodyEl,
			this.currentFile?.path ?? '',
			this,
		);

		// Footer: timestamp + actions
		const footer = item.createDiv({cls: 'marginalia-footer'});

		const time = new Date(root.createdAt);
		footer.createEl('span', {
			text: time.toLocaleString(),
			cls: 'marginalia-timestamp',
		});

		const actions = footer.createDiv({cls: 'marginalia-actions'});

		const resolveBtn = actions.createEl('button', {
			cls: 'marginalia-action-btn clickable-icon',
			attr: {'aria-label': resolved ? 'Unresolve' : 'Resolve'},
		});
		setIcon(resolveBtn, resolved ? 'circle' : 'check-circle');
		resolveBtn.addEventListener('click', () => {
			void this.toggleResolution(root);
		});

		const replyBtn = actions.createEl('button', {
			cls: 'marginalia-action-btn clickable-icon',
			attr: {'aria-label': `Reply (${replyCount})`},
		});
		setIcon(replyBtn, 'message-circle');
		if (replyCount > 0) {
			replyBtn.createEl('span', {
				text: String(replyCount),
				cls: 'marginalia-reply-count-badge',
			});
		}
		replyBtn.addEventListener('click', () => {
			this.addReply(root);
		});

		const editBtn = actions.createEl('button', {
			cls: 'marginalia-action-btn clickable-icon',
			attr: {'aria-label': 'Edit comment'},
		});
		setIcon(editBtn, 'pencil');
		editBtn.addEventListener('click', () => {
			this.editComment(root);
		});

		const deleteBtn = actions.createEl('button', {
			cls: 'marginalia-action-btn clickable-icon',
			attr: {'aria-label': 'Delete comment'},
		});
		setIcon(deleteBtn, 'trash');
		deleteBtn.addEventListener('click', () => {
			void this.deleteComment(root);
		});
	}

	private renderReply(container: HTMLElement, reply: ReplyComment): void {
		const item = container.createDiv({
			cls: 'marginalia-reply',
			attr: {'data-reply-id': reply.id},
		});

		// Reply body (rendered as Markdown)
		const bodyEl = item.createDiv({cls: 'marginalia-body'});
		void MarkdownRenderer.render(
			this.plugin.app,
			reply.body,
			bodyEl,
			this.currentFile?.path ?? '',
			this,
		);

		// Footer: timestamp + actions
		const footer = item.createDiv({cls: 'marginalia-footer'});

		const time = new Date(reply.createdAt);
		footer.createEl('span', {
			text: time.toLocaleString(),
			cls: 'marginalia-timestamp',
		});

		const actions = footer.createDiv({cls: 'marginalia-actions'});

		const editBtn = actions.createEl('button', {
			cls: 'marginalia-action-btn clickable-icon',
			attr: {'aria-label': 'Edit reply'},
		});
		setIcon(editBtn, 'pencil');
		editBtn.addEventListener('click', () => {
			this.editComment(reply);
		});

		const deleteBtn = actions.createEl('button', {
			cls: 'marginalia-action-btn clickable-icon',
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

	private async toggleResolution(comment: RootComment): Promise<void> {
		if (!this.currentFile) return;
		await this.plugin.store.toggleResolution(this.currentFile.path, comment.id);
		await this.refresh();
		if (!isNoteComment(comment)) {
			this.plugin.updateGutterEffects();
		}
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
