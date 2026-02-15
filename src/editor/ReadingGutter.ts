import {MarkdownRenderChild, MarkdownView, setIcon} from 'obsidian';
import type {MarkdownPostProcessorContext} from 'obsidian';
import type MarginaliaPlugin from '../main';
import {isRootComment, getRootResolution} from '../types';

interface LineGroup {
	commentIds: string[];
	count: number;
	allResolved: boolean;
}

export class ReadingGutter {
	private plugin: MarginaliaPlugin;

	constructor(plugin: MarginaliaPlugin) {
		this.plugin = plugin;
	}

	processSection(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
		if (!this.plugin.settings.showGutterIcons) return;

		const info = ctx.getSectionInfo(el);
		if (!info) return;

		const cachedFilePath = this.plugin.getCachedFilePath();
		if (!cachedFilePath || ctx.sourcePath !== cachedFilePath) return;

		el.dataset['marginaliaLineStart'] = String(info.lineStart);
		el.dataset['marginaliaLineEnd'] = String(info.lineEnd);

		const groups = this.getGroupsForRange(info.lineStart, info.lineEnd);
		if (groups.size === 0) return;

		this.injectIcons(el, groups, ctx);
	}

	refreshActiveView(): void {
		if (!this.plugin.settings.showGutterIcons) return;

		const mdView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (!mdView || mdView.getMode() !== 'preview') return;

		const previewEl = mdView.previewMode.containerEl;

		// Remove all existing reading view icons
		const existing = Array.from(previewEl.querySelectorAll('.marginalia-rv-icon'));
		for (const icon of existing) {
			icon.remove();
		}

		// Remove marginalia-has-comment class from all sections
		const marked = Array.from(previewEl.querySelectorAll('.marginalia-has-comment'));
		for (const section of marked) {
			section.removeClass('marginalia-has-comment');
		}

		// Walk sections with data attributes
		const sections = Array.from(previewEl.querySelectorAll<HTMLElement>('[data-marginalia-line-start]'));
		for (const section of sections) {
			const lineStart = parseInt(section.dataset['marginaliaLineStart'] ?? '', 10);
			const lineEnd = parseInt(section.dataset['marginaliaLineEnd'] ?? '', 10);
			if (isNaN(lineStart) || isNaN(lineEnd)) continue;

			const groups = this.getGroupsForRange(lineStart, lineEnd);
			if (groups.size === 0) continue;

			section.addClass('marginalia-has-comment');

			for (const [, group] of groups) {
				const iconEl = this.createGutterIcon(group);
				iconEl.addClass('marginalia-rv-icon');
				section.prepend(iconEl);
			}
		}
	}

	private getGroupsForRange(lineStart: number, lineEnd: number): Map<number, LineGroup> {
		const anchors = this.plugin.getCachedAnchors();
		const comments = this.plugin.getCachedComments();

		// Build resolution map
		const resolutionMap = new Map<string, 'open' | 'resolved'>();
		for (const c of comments) {
			if (isRootComment(c)) {
				resolutionMap.set(c.id, getRootResolution(c));
			}
		}

		// Group anchors by line within the section range
		const byLine = new Map<number, LineGroup>();
		for (const [commentId, anchor] of anchors) {
			if (anchor.line < lineStart || anchor.line > lineEnd) continue;

			const existing = byLine.get(anchor.line);
			const resolved = resolutionMap.get(commentId) === 'resolved';
			if (existing) {
				existing.commentIds.push(commentId);
				existing.count += 1;
				existing.allResolved = existing.allResolved && resolved;
			} else {
				byLine.set(anchor.line, {
					commentIds: [commentId],
					count: 1,
					allResolved: resolved,
				});
			}
		}
		return byLine;
	}

	private injectIcons(
		el: HTMLElement,
		groups: Map<number, LineGroup>,
		ctx: MarkdownPostProcessorContext
	): void {
		el.addClass('marginalia-has-comment');

		for (const [, group] of groups) {
			const iconEl = this.createGutterIcon(group);
			iconEl.addClass('marginalia-rv-icon');
			el.prepend(iconEl);
			ctx.addChild(new MarkdownRenderChild(iconEl));
		}
	}

	private createGutterIcon(group: LineGroup): HTMLElement {
		const el = document.createElement('span');
		el.className = 'marginalia-gutter-icon';
		if (group.allResolved) {
			el.className += ' marginalia-gutter-resolved';
		}
		el.setAttribute('aria-label', `${group.count} comment${group.count > 1 ? 's' : ''}`);
		setIcon(el, group.allResolved ? 'check-circle' : 'message-square');

		if (group.count > 1) {
			const badge = document.createElement('span');
			badge.className = 'marginalia-badge';
			badge.textContent = String(group.count);
			el.appendChild(badge);
		}

		el.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			const firstId = group.commentIds[0];
			if (firstId) this.plugin.scrollPanelToComment(firstId);
		});

		el.addEventListener('mouseenter', () => {
			this.plugin.showPopover(el, group.commentIds);
		});
		el.addEventListener('mouseleave', () => {
			this.plugin.hidePopover();
		});

		return el;
	}
}
