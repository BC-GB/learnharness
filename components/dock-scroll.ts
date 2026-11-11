import { forwardDockWheel } from "./dock-height";
import { RESPONSE_BOTTOM_EVENT, RESPONSE_START_EVENT } from "./streaming-response-anchor";

export const DOCK_REVEAL_EVENT = "lh-dock-reveal";

export interface DockScrollState {
	ownsDock: boolean;
	expanded: boolean;
	following: boolean;
	expandIntent: boolean;
	revealPending: boolean;
	geometryAt: number;
	growthAt: number;
}

/** Layout changes must not fold a dock, but real navigation must remain
 * available while tokens arrive. The library's `isAtBottom` can describe a
 * custom response hold rather than the transcript's actual bottom. */
export function bindDockScroll({ scroll, dock, state, setExpanded, scrollToBottom, now = Date.now }: {
	scroll: HTMLElement;
	dock: HTMLElement;
	state: () => DockScrollState;
	setExpanded: (expanded: boolean) => void;
	scrollToBottom: () => void;
	now?: () => number;
}) {
	let inputTop = scroll.scrollTop;
	let inputUntil = 0;
	let inputDirection = 0;
	let draggingScrollbar = false;
	let touchY: number | undefined;
	const nestedConsumes = (target: EventTarget | null, direction: number) => {
		for (let n = target as HTMLElement | null; n && n !== scroll; n = n.parentElement) {
			if (!(n instanceof HTMLElement) || !/^(auto|scroll)$/.test(getComputedStyle(n).overflowY)) continue;
			if (n.scrollHeight - n.clientHeight < 2) continue;
			if (direction < 0 ? n.scrollTop > 0 : n.scrollTop < n.scrollHeight - n.clientHeight - 0.5) return true;
		}
		return false;
	};
	const noteInput = (direction = 0) => {
		const remaining = scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop;
		if ((direction < 0 && scroll.scrollTop <= 0) || (direction > 0 && remaining <= 1)) {
			inputUntil = 0;
			return;
		}
		inputTop = scroll.scrollTop;
		inputUntil = now() + 500;
		inputDirection = direction;
	};
	const wheel = (event: WheelEvent) => {
		if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey ||
			event.deltaY === 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
		// Code blocks and other nested transcript scrollers consume their
		// own input; it must not authorize a later automatic transcript move.
		if (nestedConsumes(event.target, event.deltaY)) return;
		noteInput(Math.sign(event.deltaY));
	};
	const dockWheel = (event: WheelEvent) => {
		const before = scroll.scrollTop;
		forwardDockWheel(event, dock, scroll);
		// Internal question/input scrollers retain their own wheel handling.
		if (scroll.scrollTop !== before) {
			inputTop = before;
			inputUntil = now() + 500;
			inputDirection = Math.sign(event.deltaY);
		}
	};
	const keydown = (event: KeyboardEvent) => {
		const target = event.target as HTMLElement | null;
		if (event.defaultPrevented || event.altKey || event.metaKey ||
			target?.isContentEditable || target?.closest("input, textarea, select, button, [contenteditable]:not([contenteditable=false])")) return;
		const direction = ["ArrowUp", "PageUp", "Home"].includes(event.key) ? -1
			: ["ArrowDown", "PageDown", "End"].includes(event.key) ? 1
				: event.key === " " ? (event.shiftKey ? -1 : 1) : 0;
		if (direction && !nestedConsumes(event.target, direction)) noteInput(direction);
	};
	const touchstart = (event: TouchEvent) => { touchY = event.touches[0]?.clientY; };
	const touchmove = (event: TouchEvent) => {
		const nextY = event.touches[0]?.clientY;
		const direction = touchY !== undefined && nextY !== undefined ? Math.sign(touchY - nextY) : 0;
		touchY = nextY;
		if (direction && !nestedConsumes(event.target, direction)) noteInput(direction);
	};
	const touchend = () => { touchY = undefined; };
	const pointerdown = (event: PointerEvent) => {
		if (event.target === scroll) {
			draggingScrollbar = true;
			noteInput();
		}
	};
	const pointerup = () => { if (draggingScrollbar) inputUntil = 0; draggingScrollbar = false; };
	const resetInput = () => {
		inputUntil = 0;
		inputTop = scroll.scrollTop;
		draggingScrollbar = false;
		touchY = undefined;
	};
	const onScroll = () => {
		const top = scroll.scrollTop;
		const delta = top - inputTop;
		const manual = (draggingScrollbar || now() <= inputUntil) && Math.abs(delta) > 1 &&
			(draggingScrollbar || inputDirection === 0 || Math.sign(delta) === inputDirection);
		if (manual) inputTop = top;
		const s = state();
		if (!s.ownsDock) return;
		// Input wins over resize/growth suppression, even when every token
		// refreshes the mute and the custom target says we are "at bottom".
		if (!manual && (now() - s.geometryAt < 400 || now() - s.growthAt < 400)) return;
		const distance = scroll.scrollHeight - scroll.clientHeight - top;
		if (s.expanded) {
			if (distance > 96 && (manual || (!s.expandIntent && !s.following))) setExpanded(false);
		} else if (distance < 16 && !s.revealPending) {
			setExpanded(true);
			scrollToBottom();
		}
	};
	scroll.addEventListener("wheel", wheel, { passive: true });
	dock.addEventListener("wheel", dockWheel, { passive: false });
	scroll.addEventListener("touchstart", touchstart, { passive: true });
	scroll.addEventListener("touchmove", touchmove, { passive: true });
	scroll.addEventListener("touchend", touchend, { passive: true });
	scroll.addEventListener("touchcancel", touchend, { passive: true });
	scroll.addEventListener("keydown", keydown);
	scroll.addEventListener("pointerdown", pointerdown);
	scroll.ownerDocument.addEventListener("pointerup", pointerup);
	scroll.ownerDocument.addEventListener("pointercancel", pointerup);
	scroll.addEventListener(RESPONSE_BOTTOM_EVENT, resetInput);
	scroll.addEventListener(RESPONSE_START_EVENT, resetInput);
	scroll.addEventListener(DOCK_REVEAL_EVENT, resetInput);
	scroll.addEventListener("scroll", onScroll, { passive: true });
	return () => {
		scroll.removeEventListener("wheel", wheel);
		dock.removeEventListener("wheel", dockWheel);
		scroll.removeEventListener("touchstart", touchstart);
		scroll.removeEventListener("touchmove", touchmove);
		scroll.removeEventListener("touchend", touchend);
		scroll.removeEventListener("touchcancel", touchend);
		scroll.removeEventListener("keydown", keydown);
		scroll.removeEventListener("pointerdown", pointerdown);
		scroll.ownerDocument.removeEventListener("pointerup", pointerup);
		scroll.ownerDocument.removeEventListener("pointercancel", pointerup);
		scroll.removeEventListener(RESPONSE_BOTTOM_EVENT, resetInput);
		scroll.removeEventListener(RESPONSE_START_EVENT, resetInput);
		scroll.removeEventListener(DOCK_REVEAL_EVENT, resetInput);
		scroll.removeEventListener("scroll", onScroll);
	};
}
