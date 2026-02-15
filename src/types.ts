export interface CommentTarget {
	exact: string;
	prefix: string;
	suffix: string;
	headingContext?: string;
	lineHint?: number;
}

export interface AnchoredComment {
	kind: 'anchored';
	id: string;
	body: string;
	target: CommentTarget;
	status: 'active' | 'orphaned';
	createdAt: string;
	updatedAt: string;
}

export interface NoteComment {
	kind: 'note';
	id: string;
	body: string;
	createdAt: string;
	updatedAt: string;
}

export type RootComment = AnchoredComment | NoteComment;

export interface ReplyComment {
	id: string;
	parentId: string;
	body: string;
	createdAt: string;
	updatedAt: string;
}

export type CommentData = RootComment | ReplyComment;

export function isRootComment(c: CommentData): c is RootComment {
	return !('parentId' in c);
}

export function isReplyComment(c: CommentData): c is ReplyComment {
	return 'parentId' in c;
}

export function isAnchoredComment(c: CommentData): c is AnchoredComment {
	return !('parentId' in c) && ((c as AnchoredComment).kind === 'anchored' || !('kind' in c));
}

export function isNoteComment(c: CommentData): c is NoteComment {
	return 'kind' in c && (c as NoteComment).kind === 'note';
}

export interface CommentThread {
	root: AnchoredComment;
	replies: ReplyComment[];
}

export interface PanelData {
	noteComments: NoteComment[];
	threads: CommentThread[];
}

export interface CommentFile {
	version: 1;
	sourceFile: string;
	comments: CommentData[];
}

export interface PathIndexData {
	version: 1;
	mappings: Record<string, string>;
}

export interface ResolvedAnchor {
	from: number;
	to: number;
	line: number;
	stage: 1 | 2 | 3;
}
