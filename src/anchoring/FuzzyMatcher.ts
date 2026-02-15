export function normalizeWhitespace(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

export function levenshteinDistance(a: string, b: string): number {
	if (a === b) return 0;
	if (a.length === 0) return b.length;
	if (b.length === 0) return a.length;

	// Ensure a is shorter for O(min(n,m)) memory
	if (a.length > b.length) {
		[a, b] = [b, a];
	}

	const aLen = a.length;
	const bLen = b.length;
	let prev = new Uint32Array(aLen + 1);
	let curr = new Uint32Array(aLen + 1);

	for (let i = 0; i <= aLen; i++) {
		prev[i] = i;
	}

	for (let j = 1; j <= bLen; j++) {
		curr[0] = j;
		for (let i = 1; i <= aLen; i++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			curr[i] = Math.min(
				curr[i - 1]! + 1,
				prev[i]! + 1,
				prev[i - 1]! + cost
			);
		}
		[prev, curr] = [curr, prev];
	}

	return prev[aLen]!;
}

export interface FuzzyMatchResult {
	index: number;
	length: number;
	distance: number;
}

export function fuzzyMatch(
	needle: string,
	haystack: string,
	threshold: number
): FuzzyMatchResult | null {
	const normalizedNeedle = normalizeWhitespace(needle);
	const normalizedHaystack = normalizeWhitespace(haystack);

	if (normalizedNeedle.length === 0) return null;

	const maxDistance = Math.floor(normalizedNeedle.length * threshold);
	let bestResult: FuzzyMatchResult | null = null;

	// Sliding window with varying window sizes
	const minWindow = Math.max(1, normalizedNeedle.length - maxDistance);
	const maxWindow = normalizedNeedle.length + maxDistance;

	for (let winLen = minWindow; winLen <= Math.min(maxWindow, normalizedHaystack.length); winLen++) {
		for (let i = 0; i <= normalizedHaystack.length - winLen; i++) {
			const candidate = normalizedHaystack.substring(i, i + winLen);
			const dist = levenshteinDistance(normalizedNeedle, candidate);

			if (dist > maxDistance) continue;

			if (!bestResult || dist < bestResult.distance) {
				bestResult = {
					index: i,
					length: winLen,
					distance: dist,
				};
				if (dist === 0) return bestResult;
			}
		}
	}

	return bestResult;
}

export function fuzzyMatchInOriginal(
	needle: string,
	originalText: string,
	threshold: number
): FuzzyMatchResult | null {
	const normalizedText = normalizeWhitespace(originalText);
	const result = fuzzyMatch(needle, normalizedText, threshold);
	if (!result) return null;

	// Map normalized index back to original text
	let normalizedIdx = 0;
	let originalIdx = 0;
	let matchStart = -1;
	let matchEnd = -1;

	const trimmedStart = originalText.length - originalText.trimStart().length;
	originalIdx = trimmedStart;

	// Walk through original text tracking normalized position
	let prevWasSpace = false;
	for (; originalIdx < originalText.length && normalizedIdx < result.index + result.length; originalIdx++) {
		const ch = originalText[originalIdx]!;
		const isSpace = /\s/.test(ch);

		if (isSpace) {
			if (!prevWasSpace && normalizedIdx > 0) {
				if (normalizedIdx === result.index) {
					matchStart = originalIdx;
				}
				normalizedIdx++;
			}
			prevWasSpace = true;
		} else {
			if (normalizedIdx === result.index) {
				matchStart = originalIdx;
			}
			normalizedIdx++;
			prevWasSpace = false;
		}

		if (normalizedIdx === result.index + result.length && matchEnd === -1) {
			matchEnd = originalIdx + (isSpace ? 0 : 1);
		}
	}

	if (matchStart === -1) return null;
	if (matchEnd === -1) matchEnd = originalIdx;

	return {
		index: matchStart,
		length: matchEnd - matchStart,
		distance: result.distance,
	};
}
