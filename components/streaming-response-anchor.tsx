"use client";

import { useEffect, useRef } from "react";
import { useStickToBottomContext, type StickToBottomContext } from "use-stick-to-bottom";

export const RESPONSE_START_EVENT = "lh-response-start";
export const RESPONSE_CANCEL_EVENT = "lh-response-cancel";
export const RESPONSE_BOTTOM_EVENT = "lh-response-bottom";
export const RESPONSE_NAVIGATE_EVENT = "lh-response-navigate";

/** Explicit learner submissions own one snap. Passive/restored streams never
 * acquire this intent, and DOM growth never re-arms it. */
export function createResponseAnchor(context: () => StickToBottomContext, tail: HTMLElement) {
	let previous = new Set<string>();
	let eligible = false;
	let holding = false;
	let floor = 0;
	let previousTarget: StickToBottomContext["targetScrollTop"] = null;
	const main = () => context().scrollRef.current;
	const passages = () => Array.from(main()?.querySelectorAll<HTMLElement>("[data-response-part-id]") ?? []);
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
		const content = context().contentRef.current;
		if (!el || !content || !floor) return;
		const old = parseFloat(tail.style.height) || 0;
		const natural = content.getBoundingClientRect().height - old;
		tail.style.height = `${Math.max(0, floor - natural)}px`;
	};
	const cancelPending = () => { eligible = false; };
	const cancel = () => { eligible = false; release(); };
	const bottom = () => {
		cancel();
		floor = 0;
		tail.style.height = "0px";
	};
	const anchor = () => {
		if (!eligible) return;
		// Chat emits the marker only for nonempty source text. Markdown can
		// commit its own text later; do not wait for DOM textContent.
		const target = passages().find(node => !previous.has(node.dataset.responsePartId!));
		const el = main();
		if (!target || !el) return;
		eligible = false;
		const top = Math.max(0, el.scrollTop + target.getBoundingClientRect().top - el.getBoundingClientRect().top - 16);
		// Tokens consume this reserve. Keep a short reply's remainder after
		// completion so removing it cannot clamp the viewport backwards.
		floor = top + el.clientHeight;
		measure();
		context().stopScroll();
		el.scrollTo({ top, behavior: "instant" });
	};
	return {
		measure, cancelPending, cancel, bottom,
		begin() {
			release();
			previous = new Set(passages().map(node => node.dataset.responsePartId!));
			eligible = true;
			previousTarget = context().targetScrollTop;
			context().stopScroll();
			context().targetScrollTop = holdTarget;
			holding = true;
		},
		update(active: boolean) {
			if (!holding) return;
			anchor();
			// Includes a complete single-chunk reply in the terminal commit.
			if (!active) cancel();
		},
		dispose() { cancel(); },
	};
}

/** Scroll events do not identify their cause. Browser anchoring, input
 * clearing and dock measurements can move scrollTop before the reply arrives.
 * Only explicit navigation cancels the learner's pending response snap. */
export function bindResponseAnchorEvents(el: HTMLElement, instance: ReturnType<typeof createResponseAnchor>) {
	el.addEventListener(RESPONSE_START_EVENT, instance.begin);
	el.addEventListener(RESPONSE_CANCEL_EVENT, instance.cancel);
	el.addEventListener(RESPONSE_BOTTOM_EVENT, instance.bottom);
	el.addEventListener(RESPONSE_NAVIGATE_EVENT, instance.cancelPending);
	return () => {
		el.removeEventListener(RESPONSE_START_EVENT, instance.begin);
		el.removeEventListener(RESPONSE_CANCEL_EVENT, instance.cancel);
		el.removeEventListener(RESPONSE_BOTTOM_EVENT, instance.bottom);
		el.removeEventListener(RESPONSE_NAVIGATE_EVENT, instance.cancelPending);
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
		const unbind = el ? bindResponseAnchorEvents(el, instance) : undefined;
		const observer = new ResizeObserver(instance.measure);
		if (content) observer.observe(content);
		if (el) observer.observe(el);
		return () => {
			observer.disconnect();
			unbind?.();
			instance.dispose();
			controller.current = null;
		};
	}, []);
	useEffect(() => { controller.current?.update(active); }, [active, revision]);
	return <div ref={tail} aria-hidden="true" data-testid="response-anchor-spacer" className="shrink-0" />;
}
