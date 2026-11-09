"use client";

import { useEffect, useRef } from "react";
import { useStickToBottomContext, type StickToBottomContext } from "use-stick-to-bottom";

export const RESPONSE_START_EVENT = "lh-response-start";
export const RESPONSE_CANCEL_EVENT = "lh-response-cancel";
export const RESPONSE_BOTTOM_EVENT = "lh-response-bottom";

/** Explicit learner submissions own one snap. Passive/restored streams never
 * acquire this intent, and DOM growth never re-arms it. */
export function createResponseAnchor(context: () => StickToBottomContext, tail: HTMLElement) {
	let previous = new Set<string>();
	let eligible = false;
	let holding = false;
	let floor = 0;
	let observedTop = context().scrollRef.current?.scrollTop ?? 0;
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
	const onScroll = () => {
		const el = main();
		if (!el) return;
		const top = el.scrollTop;
		const maximum = Math.max(0, el.scrollHeight - el.clientHeight);
		// Replacing an answered question with the composer can shrink the
		// transcript and clamp its old bottom position. That is not navigation.
		const clamped = observedTop > maximum + 2 && top >= maximum - 2;
		if (!clamped && Math.abs(top - observedTop) > 2) cancelPending();
		observedTop = top;
	};
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
		observedTop = el.scrollTop;
	};
	return {
		measure, cancelPending, cancel, onScroll, bottom,
		begin() {
			release();
			previous = new Set(passages().map(node => node.dataset.responsePartId!));
			eligible = true;
			observedTop = main()?.scrollTop ?? 0;
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
		// Confidence/dock controls do not express transcript scroll intent.
		const wheel = (event: WheelEvent) => {
			if (event.deltaY && !event.ctrlKey && !event.metaKey) instance.cancelPending();
		};
		el?.addEventListener("wheel", wheel, { passive: true });
		el?.addEventListener("touchmove", instance.cancelPending, { passive: true });
		el?.addEventListener("scroll", instance.onScroll, { passive: true });
		el?.addEventListener(RESPONSE_START_EVENT, instance.begin);
		el?.addEventListener(RESPONSE_CANCEL_EVENT, instance.cancel);
		el?.addEventListener(RESPONSE_BOTTOM_EVENT, instance.bottom);
		const observer = new ResizeObserver(instance.measure);
		if (content) observer.observe(content);
		if (el) observer.observe(el);
		return () => {
			observer.disconnect();
			el?.removeEventListener("wheel", wheel);
			el?.removeEventListener("touchmove", instance.cancelPending);
			el?.removeEventListener("scroll", instance.onScroll);
			el?.removeEventListener(RESPONSE_START_EVENT, instance.begin);
			el?.removeEventListener(RESPONSE_CANCEL_EVENT, instance.cancel);
			el?.removeEventListener(RESPONSE_BOTTOM_EVENT, instance.bottom);
			instance.dispose();
			controller.current = null;
		};
	}, []);
	useEffect(() => { controller.current?.update(active); }, [active, revision]);
	return <div ref={tail} aria-hidden="true" data-testid="response-anchor-spacer" className="shrink-0" />;
}
