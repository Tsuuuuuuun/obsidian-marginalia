export interface CommentTarget {
	exact: string;
	prefix: string;
	suffix: string;
	headingContext?: string;
	lineHint?: number;
}

export interface CommentData {
	id: string;
	body: string;
	target: CommentTarget;
	status: 'active' | 'orphaned';
	createdAt: string;
	updatedAt: string;
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
