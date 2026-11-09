/** Bind only to the editable confidence row, never to the document. */
export function bindConfidenceWheel(row: HTMLElement, step: (direction: number) => void) {
	let lastStep = -Infinity;
	let lastDirection = 0;
	const reset = () => { lastStep = -Infinity; lastDirection = 0; };
	const wheel = (event: WheelEvent) => {
		// Preserve pinch/browser zoom and horizontal scrolling.
		if (event.ctrlKey || event.metaKey || event.shiftKey || event.deltaY === 0 ||
			!Number.isFinite(event.deltaY) || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
		event.preventDefault();
		event.stopPropagation(); // The dock must not forward this gesture to the transcript.
		const direction = event.deltaY < 0 ? 1 : -1;
		// Trackpads emit dense streams. Reversing direction is immediate.
		if (direction === lastDirection && event.timeStamp - lastStep < 100) return;
		lastStep = event.timeStamp;
		lastDirection = direction;
		step(direction);
	};
	row.addEventListener("wheel", wheel, { passive: false });
	row.addEventListener("pointerleave", reset);
	return () => {
		row.removeEventListener("wheel", wheel);
		row.removeEventListener("pointerleave", reset);
	};
}
