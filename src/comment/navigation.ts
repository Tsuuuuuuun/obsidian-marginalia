import type {ResolvedAnchor} from '../types';

export function findNavigationTarget(
	anchors: Map<string, ResolvedAnchor>,
	currentOffset: number,
	direction: 'next' | 'prev'
): ResolvedAnchor | null {
	if (anchors.size === 0) return null;

	const sorted = [...anchors.entries()].sort((a, b) => a[1].from - b[1].from);

	let target: [string, ResolvedAnchor] | undefined;

	if (direction === 'next') {
		target = sorted.find(([, a]) => a.from > currentOffset);
		if (!target) target = sorted[0]; // Wrap around
	} else {
		target = [...sorted].reverse().find(([, a]) => a.from < currentOffset);
		if (!target) target = sorted[sorted.length - 1]; // Wrap around
	}

	return target ? target[1] : null;
}
