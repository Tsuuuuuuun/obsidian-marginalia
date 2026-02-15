import type SideCommentPlugin from '../main';
import type {CommentData} from '../types';

export class CommentPopover {
	private plugin: SideCommentPlugin;
	private popoverEl: HTMLElement;
	private hideTimer: ReturnType<typeof setTimeout> | null = null;
	private currentCommentIds: string[] = [];

	constructor(plugin: SideCommentPlugin) {
		this.plugin = plugin;
		this.popoverEl = document.createElement('div');
		this.popoverEl.className = 'side-comment-popover';
		this.popoverEl.addClass('side-comment-popover-hidden');
		document.body.appendChild(this.popoverEl);

		this.popoverEl.addEventListener('mouseenter', () => {
			this.cancelHide();
		});
		this.popoverEl.addEventListener('mouseleave', () => {
			this.scheduleHide();
		});
	}

	async show(anchor: HTMLElement, commentIds: string[]): Promise<void> {
		this.cancelHide();
		this.currentCommentIds = commentIds;

		const file = this.plugin.app.workspace.getActiveFile();
		if (!file) return;

		const allComments = await this.plugin.store.getComments(file.path);
		const matched: CommentData[] = [];
		for (const id of commentIds) {
			const c = allComments.find(cm => cm.id === id);
			if (c) matched.push(c);
		}
		if (matched.length === 0) return;

		this.popoverEl.empty();

		for (let i = 0; i < matched.length; i++) {
			const comment = matched[i]!;

			if (i > 0) {
				this.popoverEl.createEl('hr', {cls: 'side-comment-popover-divider'});
			}

			const item = this.popoverEl.createEl('div', {cls: 'side-comment-popover-item'});
			const bodyPreview = comment.body.length > 150
				? comment.body.substring(0, 150) + '...'
				: comment.body;
			item.createEl('div', {
				text: bodyPreview,
				cls: 'side-comment-popover-body',
			});

			item.addEventListener('click', (e) => {
				e.stopPropagation();
				this.plugin.scrollPanelToComment(comment.id);
				this.hide();
			});
		}

		this.popoverEl.createEl('div', {
			text: 'Click to view in panel',
			cls: 'side-comment-popover-hint',
		});

		// Position relative to anchor
		const rect = anchor.getBoundingClientRect();
		this.popoverEl.setCssProps({
			'--popover-top': `${rect.bottom + 4}px`,
			'--popover-left': `${rect.left}px`,
		});
		this.popoverEl.removeClass('side-comment-popover-hidden');
	}

	hide(): void {
		this.popoverEl.addClass('side-comment-popover-hidden');
		this.currentCommentIds = [];
	}

	scheduleHide(): void {
		this.hideTimer = setTimeout(() => {
			this.hide();
		}, 100);
	}

	cancelHide(): void {
		if (this.hideTimer) {
			clearTimeout(this.hideTimer);
			this.hideTimer = null;
		}
	}

	destroy(): void {
		this.cancelHide();
		this.popoverEl.remove();
	}
}
