import type {AnchoredComment, CommentData, CommentThread, NoteComment, PanelData, ReplyComment, ResolvedAnchor} from '../types';
import {isAnchoredComment, isNoteComment, isReplyComment, getRootResolution} from '../types';

export function getThreads(comments: CommentData[]): CommentThread[] {
	const replyMap = new Map<string, ReplyComment[]>();
	const roots: AnchoredComment[] = [];

	for (const c of comments) {
		if (isAnchoredComment(c)) {
			roots.push(c);
		} else if (isReplyComment(c)) {
			const existing = replyMap.get(c.parentId);
			if (existing) {
				existing.push(c);
			} else {
				replyMap.set(c.parentId, [c]);
			}
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

export function getPanelData(comments: CommentData[]): PanelData {
	const noteComments: NoteComment[] = [];
	for (const c of comments) {
		if (isNoteComment(c)) {
			noteComments.push(c);
		}
	}
	noteComments.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	return {
		noteComments,
		threads: getThreads(comments),
	};
}

export function filterPanelData(
	panelData: PanelData,
	filter: 'all' | 'open' | 'resolved' | 'active' | 'orphaned',
	sortOrder: 'position' | 'created',
	anchors: Map<string, ResolvedAnchor>
): PanelData {
	let {noteComments} = panelData;
	let {threads} = panelData;

	if (filter === 'active') {
		threads = threads.filter(t => t.root.status === 'active');
		// NoteComment always visible in "active" filter
	} else if (filter === 'orphaned') {
		threads = threads.filter(t => t.root.status === 'orphaned');
		// NoteComment hidden in "orphaned" filter (they can't be orphaned)
		noteComments = [];
	} else if (filter === 'open') {
		threads = threads.filter(t => getRootResolution(t.root) === 'open');
		noteComments = noteComments.filter(nc => getRootResolution(nc) === 'open');
	} else if (filter === 'resolved') {
		threads = threads.filter(t => getRootResolution(t.root) === 'resolved');
		noteComments = noteComments.filter(nc => getRootResolution(nc) === 'resolved');
	}

	if (sortOrder === 'position') {
		threads.sort((a, b) => {
			const anchorA = anchors.get(a.root.id);
			const anchorB = anchors.get(b.root.id);
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
