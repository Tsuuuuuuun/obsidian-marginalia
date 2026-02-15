import type SideCommentPlugin from '../main';
import {getRootResolution} from '../types';

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
		const threads = this.plugin.store.getThreads(allComments);

		// Only show threads whose root is in the requested commentIds
		const matchedThreads = threads.filter(t => commentIds.includes(t.root.id));
		if (matchedThreads.length === 0) return;

		this.popoverEl.empty();

		for (let i = 0; i < matchedThreads.length; i++) {
			const thread = matchedThreads[i]!;

			if (i > 0) {
				this.popoverEl.createEl('hr', {cls: 'side-comment-popover-divider'});
			}

			const resolved = getRootResolution(thread.root) === 'resolved';
			const item = this.popoverEl.createEl('div', {
				cls: `side-comment-popover-item${resolved ? ' side-comment-popover-resolved' : ''}`,
			});
			const bodyPreview = thread.root.body.length > 150
				? thread.root.body.substring(0, 150) + '...'
				: thread.root.body;
			item.createEl('div', {
				text: bodyPreview + (resolved ? ' (resolved)' : ''),
				cls: 'side-comment-popover-body',
			});

			if (thread.replies.length > 0) {
				item.createEl('div', {
					text: `${thread.replies.length} ${thread.replies.length === 1 ? 'reply' : 'replies'}`,
					cls: 'side-comment-popover-reply-count',
				});
			}

			item.addEventListener('click', (e) => {
				e.stopPropagation();
				this.plugin.scrollPanelToComment(thread.root.id);
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
