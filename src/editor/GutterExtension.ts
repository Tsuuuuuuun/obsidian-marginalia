// eslint-disable-next-line import/no-extraneous-dependencies -- externalized, provided by Obsidian
import {
	Decoration,
	EditorView,
	WidgetType,
	type DecorationSet,
} from '@codemirror/view';
// eslint-disable-next-line import/no-extraneous-dependencies -- externalized, provided by Obsidian
import {
	StateField,
	StateEffect,
	type Extension,
} from '@codemirror/state';
import { setIcon } from 'obsidian';
import type SideCommentPlugin from '../main';

interface CommentLineInfo {
	line: number;
	commentId: string;
	count: number;
	allResolved: boolean;
}

export const updateCommentPositions = StateEffect.define<CommentLineInfo[]>();

class CommentIconWidget extends WidgetType {
	private commentIds: string[];
	private count: number;
	private allResolved: boolean;
	private plugin: SideCommentPlugin;

	constructor(plugin: SideCommentPlugin, commentIds: string[], count: number, allResolved: boolean) {
		super();
		this.plugin = plugin;
		this.commentIds = commentIds;
		this.count = count;
		this.allResolved = allResolved;
	}

	eq(other: CommentIconWidget): boolean {
		return this.count === other.count
			&& this.allResolved === other.allResolved
			&& this.commentIds.length === other.commentIds.length
			&& this.commentIds.every((id, i) => id === other.commentIds[i]);
	}

	toDOM(): HTMLElement {
		const el = document.createElement('span');
		el.className = 'side-comment-gutter-icon';
		if (this.allResolved) {
			el.className += ' side-comment-gutter-resolved';
		}
		el.setAttribute('aria-label', `${this.count} comment${this.count > 1 ? 's' : ''}`);
		setIcon(el, this.allResolved ? 'check-circle' : 'message-square');

		if (this.count > 1) {
			const badge = document.createElement('span');
			badge.className = 'side-comment-badge';
			badge.textContent = String(this.count);
			el.appendChild(badge);
		}

		el.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			const firstId = this.commentIds[0];
			if (firstId) this.plugin.scrollPanelToComment(firstId);
		});

		el.addEventListener('mouseenter', () => {
			this.plugin.showPopover(el, this.commentIds);
		});
		el.addEventListener('mouseleave', () => {
			this.plugin.hidePopover();
		});

		return el;
	}
}

function buildDecorations(
	plugin: SideCommentPlugin,
	infos: CommentLineInfo[],
	doc: { lines: number; line(n: number): { from: number } }
): DecorationSet {
	// Group by line, collecting all commentIds
	const byLine = new Map<number, {commentIds: string[]; count: number; allResolved: boolean}>();
	for (const info of infos) {
		const existing = byLine.get(info.line);
		if (existing) {
			existing.commentIds.push(info.commentId);
			existing.count += info.count;
			existing.allResolved = existing.allResolved && info.allResolved;
		} else {
			byLine.set(info.line, {commentIds: [info.commentId], count: info.count, allResolved: info.allResolved});
		}
	}

	const sortedLines = [...byLine.entries()].sort((a, b) => a[0] - b[0]);

	const ranges: {from: number; to: number; value: Decoration}[] = [];
	for (const [lineNum, {commentIds, count, allResolved}] of sortedLines) {
		if (lineNum < 0 || lineNum >= doc.lines) continue;
		const lineStart = doc.line(lineNum + 1).from;
		const widget = new CommentIconWidget(plugin, commentIds, count, allResolved);
		ranges.push({
			from: lineStart,
			to: lineStart,
			value: Decoration.widget({ widget, side: -1 }),
		});
	}

	return Decoration.set(ranges, true);
}

export function createCommentGutter(plugin: SideCommentPlugin): Extension {
	const gutterField = StateField.define<CommentLineInfo[]>({
		create(): CommentLineInfo[] {
			return [];
		},
		update(value: CommentLineInfo[], tr): CommentLineInfo[] {
			for (const effect of tr.effects) {
				if (effect.is(updateCommentPositions)) {
					return effect.value;
				}
			}
			return value;
		},
	});

	const decorationField = StateField.define<DecorationSet>({
		create(): DecorationSet {
			return Decoration.none;
		},
		update(value: DecorationSet, tr): DecorationSet {
			for (const effect of tr.effects) {
				if (effect.is(updateCommentPositions)) {
					return buildDecorations(plugin, effect.value, tr.state.doc);
				}
			}
			if (tr.docChanged) {
				return value.map(tr.changes);
			}
			return value;
		},
		provide: (f) => EditorView.decorations.from(f),
	});

	return [gutterField, decorationField];
}
