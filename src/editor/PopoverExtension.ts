import type MarginaliaPlugin from '../main';
import {getRootResolution} from '../types';

export class CommentPopover {
	private plugin: MarginaliaPlugin;
	private popoverEl: HTMLElement;
	private hideTimer: ReturnType<typeof setTimeout> | null = null;
	private currentCommentIds: string[] = [];

	constructor(plugin: MarginaliaPlugin) {
		this.plugin = plugin;
		this.popoverEl = document.createElement('div');
		this.popoverEl.className = 'marginalia-popover';
		this.popoverEl.addClass('marginalia-popover-hidden');
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
				this.popoverEl.createEl('hr', {cls: 'marginalia-popover-divider'});
			}

			const resolved = getRootResolution(thread.root) === 'resolved';
			const item = this.popoverEl.createEl('div', {
				cls: `marginalia-popover-item${resolved ? ' marginalia-popover-resolved' : ''}`,
			});
			const bodyPreview = thread.root.body.length > 150
				? thread.root.body.substring(0, 150) + '...'
				: thread.root.body;
			item.createEl('div', {
				text: bodyPreview + (resolved ? ' (resolved)' : ''),
				cls: 'marginalia-popover-body',
			});

			if (thread.replies.length > 0) {
				item.createEl('div', {
					text: `${thread.replies.length} ${thread.replies.length === 1 ? 'reply' : 'replies'}`,
					cls: 'marginalia-popover-reply-count',
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
			cls: 'marginalia-popover-hint',
		});

		// Position relative to anchor
		const rect = anchor.getBoundingClientRect();
		this.popoverEl.setCssProps({
			'--popover-top': `${rect.bottom + 4}px`,
			'--popover-left': `${rect.left}px`,
		});
		this.popoverEl.removeClass('marginalia-popover-hidden');
	}

	hide(): void {
		this.popoverEl.addClass('marginalia-popover-hidden');
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
