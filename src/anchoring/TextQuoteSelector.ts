import type {CommentTarget, ResolvedAnchor} from '../types';
import {fuzzyMatchInOriginal, normalizeWhitespace} from './FuzzyMatcher';

export function resolveAnchor(
	target: CommentTarget,
	docText: string,
	threshold: number
): ResolvedAnchor | null {
	// Stage 1: lineHint fast path + exact match
	const stage1 = resolveStage1(target, docText);
	if (stage1) return stage1;

	// Stage 2: full-text exact search + prefix/suffix scoring
	const stage2 = resolveStage2(target, docText);
	if (stage2) return stage2;

	// Stage 3: whitespace normalization + Levenshtein fuzzy
	return resolveStage3(target, docText, threshold);
}

function resolveStage1(target: CommentTarget, docText: string): ResolvedAnchor | null {
	if (target.lineHint == null) return null;

	const lines = docText.split('\n');
	const startLine = Math.max(0, target.lineHint - 20);
	const endLine = Math.min(lines.length, target.lineHint + 21);

	// Build the substring for the search region
	let regionStart = 0;
	for (let i = 0; i < startLine; i++) {
		regionStart += lines[i]!.length + 1;
	}

	let regionEnd = regionStart;
	for (let i = startLine; i < endLine; i++) {
		regionEnd += lines[i]!.length + 1;
	}
	regionEnd = Math.min(regionEnd, docText.length);

	const region = docText.substring(regionStart, regionEnd);
	const idx = region.indexOf(target.exact);
	if (idx === -1) return null;

	const absoluteFrom = regionStart + idx;
	const absoluteTo = absoluteFrom + target.exact.length;
	return {
		from: absoluteFrom,
		to: absoluteTo,
		line: computeLineNumber(docText, absoluteFrom),
		stage: 1,
	};
}

function resolveStage2(target: CommentTarget, docText: string): ResolvedAnchor | null {
	const candidates: Array<{from: number; to: number; score: number}> = [];

	let searchFrom = 0;
	while (searchFrom < docText.length) {
		const idx = docText.indexOf(target.exact, searchFrom);
		if (idx === -1) break;

		const score = scoreContext(target, docText, idx, idx + target.exact.length);
		candidates.push({from: idx, to: idx + target.exact.length, score});
		searchFrom = idx + 1;
	}

	if (candidates.length === 0) return null;

	candidates.sort((a, b) => b.score - a.score);
	const best = candidates[0]!;

	return {
		from: best.from,
		to: best.to,
		line: computeLineNumber(docText, best.from),
		stage: 2,
	};
}

function resolveStage3(target: CommentTarget, docText: string, threshold: number): ResolvedAnchor | null {
	const result = fuzzyMatchInOriginal(target.exact, docText, threshold);
	if (!result) return null;

	const from = result.index;
	const to = from + result.length;

	// Validate with prefix/suffix context if available
	const contextScore = scoreContext(target, docText, from, to);
	if (contextScore < 0) return null;

	return {
		from,
		to,
		line: computeLineNumber(docText, from),
		stage: 3,
	};
}

function scoreContext(
	target: CommentTarget,
	docText: string,
	matchFrom: number,
	matchTo: number
): number {
	let score = 0;

	if (target.prefix) {
		const prefixLen = target.prefix.length;
		const actualPrefix = docText.substring(Math.max(0, matchFrom - prefixLen), matchFrom);
		score += computeOverlapScore(target.prefix, actualPrefix);
	}

	if (target.suffix) {
		const suffixLen = target.suffix.length;
		const actualSuffix = docText.substring(matchTo, Math.min(docText.length, matchTo + suffixLen));
		score += computeOverlapScore(target.suffix, actualSuffix);
	}

	if (target.headingContext) {
		const heading = findHeadingContext(docText, matchFrom);
		if (heading && normalizeWhitespace(heading) === normalizeWhitespace(target.headingContext)) {
			score += 2;
		}
	}

	return score;
}

function computeOverlapScore(expected: string, actual: string): number {
	if (actual.length === 0 || expected.length === 0) return 0;

	const normExpected = normalizeWhitespace(expected);
	const normActual = normalizeWhitespace(actual);

	if (normExpected === normActual) return 2;

	// Check suffix/prefix partial overlap
	const minLen = Math.min(normExpected.length, normActual.length);
	let matching = 0;
	for (let i = 0; i < minLen; i++) {
		if (normExpected[normExpected.length - 1 - i] === normActual[normActual.length - 1 - i]) {
			matching++;
		} else {
			break;
		}
	}

	return matching / minLen;
}

export function computeLineNumber(text: string, offset: number): number {
	let line = 0;
	for (let i = 0; i < offset && i < text.length; i++) {
		if (text[i] === '\n') line++;
	}
	return line;
}

export function extractContext(text: string, offset: number, length: number): string {
	const start = Math.max(0, offset);
	const end = Math.min(text.length, offset + length);
	return text.substring(start, end);
}

export function findHeadingContext(text: string, offset: number): string | null {
	const before = text.substring(0, offset);
	const headingRegex = /^(#{1,6}\s+.*)$/gm;
	let lastHeading: string | null = null;
	let match;

	while ((match = headingRegex.exec(before)) !== null) {
		lastHeading = match[1] ?? null;
	}

	return lastHeading;
}
