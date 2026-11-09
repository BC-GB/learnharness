"use client";

import { useEffect, useRef } from "react";
import { useStickToBottomContext, type StickToBottomContext } from "use-stick-to-bottom";

export const RESPONSE_BOTTOM_EVENT = "lh-response-bottom";


/** One snap per live turn, not per token or provider step. Kept independent
 * of React so synthetic geometry can exercise the actual scroll controller. */
export function createResponseAnchor(context: () => StickToBottomContext, tail: HTMLElement) {
	let previous = new Set<string>();
	let initialized = false;
	let running = false;
	let eligible = false;
	let holding = false;
	let floor = 0;
	let settledAnchor = false;
	let observedTop = context().scrollRef.current?.scrollTop ?? 0;
	let previousTarget: StickToBottomContext["targetScrollTop"] = null;
	const main = () => context().scrollRef.current;
	const passages = () => Array.from(main()?.querySelectorAll<HTMLElement>("[data-response-part-id]") ?? []);
	const ids = () => new Set(passages().map(node => node.dataset.responsePartId!));
	const holdTarget: NonNullable<StickToBottomContext["targetScrollTop"]> = (_bottom, { scrollElement }) => scrollElement.scrollTop;
	const release = () => {
		if (holding) {
			context().stopScroll();
			if (context().targetScrollTop === holdTarget) context().targetScrollTop = previousTarget;
		}
		holding = false;
	};
	const measure = () => {
		const el = main();
		if (!el || !floor) return;
		const old = parseFloat(tail.style.height) || 0;
		// Total flow height, not scrollHeight (which is at least viewport height).
		const content = context().contentRef.current;
		if (!content) return;
		const natural = content.getBoundingClientRect().height - old;
		tail.style.height = `${Math.max(0, floor - natural)}px`;
	};
	const cancelPending = () => { eligible = false; settledAnchor = false; };
	const onScroll = () => {
		const top = main()?.scrollTop ?? 0;
		if (Math.abs(top - observedTop) > 2) cancelPending();
		observedTop = top;
	};
	const bottom = () => {
		eligible = false;
		release();
		floor = 0;
		tail.style.height = "0px";
	};
	const anchor = () => {
		if (!eligible) return;
		// The marker is emitted only for nonempty source text. Markdown may
		// render later, so readiness must not depend on its DOM textContent.
		const target = passages().find(node => !previous.has(node.dataset.responsePartId!));
		const el = main();
		if (!target || !el) return;
		eligible = false;
		const top = Math.max(0, el.scrollTop + target.getBoundingClientRect().top - el.getBoundingClientRect().top - 16);
		// Reserve only enough room for the first line to sit at the top.
		// Tokens consume this tail rather than moving the viewport. Retain
		// a short response's remainder at completion to avoid a clamp jump.
		settledAnchor = true;
		floor = top + el.clientHeight;
		measure();
		context().stopScroll();
		el.scrollTo({ top, behavior: "instant" });
		observedTop = el.scrollTop;
	};
	return {
		measure, cancelPending, onScroll, bottom,
		update(active: boolean) {
			if (!initialized) {
				initialized = true;
				previous = ids();
				// Reattaching a saved/live session must not jump backwards.
				running = active && previous.size > 0;
				if (!active || running) return;
			}
			if (active && !running) {
				// The actual follow lock also covers explicit Bottom navigation.
				// Its escaped flag may remain true during a programmatic spring;
				// the public isAtBottom also includes mere near-bottom proximity.
				eligible = settledAnchor || context().state.isAtBottom;
				if (eligible) {
					// Own the current position, including any already-applied spring
					// motion whose scroll event is still queued.
					observedTop = main()?.scrollTop ?? 0;
					previousTarget = context().targetScrollTop;
					context().stopScroll();
					context().targetScrollTop = holdTarget;
					holding = true;
				}
			}
			running = active;
			if (!active) {
				// A complete single-chunk reply can arrive with ready status.
				// Consume its existing one-shot intent in this commit, not later.
				anchor();
				eligible = false;
				release();
				previous = ids();
				return;
			}
			anchor();
		},
		dispose() { release(); },
	};
}

export function StreamingResponseAnchor({ active, revision }: { active: boolean; revision: unknown }) {
	const context = useStickToBottomContext();
	const contextRef = useRef(context);
	contextRef.current = context;
	const tail = useRef<HTMLDivElement>(null);
	const controller = useRef<ReturnType<typeof createResponseAnchor> | null>(null);
	useEffect(() => {
		if (!tail.current) return;
		const instance = createResponseAnchor(() => contextRef.current, tail.current);
		controller.current = instance;
		const el = contextRef.current.scrollRef.current;
		const content = contextRef.current.contentRef.current;
		// Dock controls (including confidence) do not express scroll intent.
		// Actual scroll events also cover keyboard/scrollbar and forwarded dock
		// scrolling; wheel/touch cancel early only inside the transcript.
		const wheel = (event: WheelEvent) => {
			if (event.deltaY && !event.ctrlKey && !event.metaKey) instance.cancelPending();
		};
		el?.addEventListener("wheel", wheel, { passive: true });
		el?.addEventListener("touchmove", instance.cancelPending, { passive: true });
		el?.addEventListener("scroll", instance.onScroll, { passive: true });
		el?.addEventListener(RESPONSE_BOTTOM_EVENT, instance.bottom);
		const observer = new ResizeObserver(instance.measure);
		if (content) observer.observe(content);
		if (el) observer.observe(el);
		return () => {
			observer.disconnect();
			el?.removeEventListener("wheel", wheel);
			el?.removeEventListener("touchmove", instance.cancelPending);
			el?.removeEventListener("scroll", instance.onScroll);
			el?.removeEventListener(RESPONSE_BOTTOM_EVENT, instance.bottom);
			instance.dispose();
			controller.current = null;
		};
	}, []);
	useEffect(() => { controller.current?.update(active); }, [active, revision]);
	return <div ref={tail} aria-hidden="true" data-testid="response-anchor-spacer" className="shrink-0" />;
}
