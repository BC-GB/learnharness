"use client";

import { useEffect, useState } from "react";
import { Maximize2Icon, Minimize2Icon } from "lucide-react";

/** Browser fullscreen only: no stored preference, server call or extra permission. */
export function FullscreenToggle() {
	const [active, setActive] = useState(false);
	const [supported, setSupported] = useState(false);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		const sync = () => {
			setActive(document.fullscreenElement !== null);
			setSupported(document.fullscreenEnabled && typeof document.documentElement.requestFullscreen === "function");
		};
		sync();
		document.addEventListener("fullscreenchange", sync);
		return () => document.removeEventListener("fullscreenchange", sync);
	}, []);
	const label = active ? "Exit fullscreen" : "Enter fullscreen";
	async function toggle() {
		setPending(true);
		setError(null);
		try {
			if (document.fullscreenElement) await document.exitFullscreen();
			else await document.documentElement.requestFullscreen();
		} catch {
			setError("Fullscreen was blocked. Use your browser's fullscreen command.");
		} finally {
			setPending(false);
		}
	}
	return (
		<div className="ml-auto flex shrink-0 items-center gap-2">
			{error && <span role="status" className="max-w-48 text-xs text-muted-foreground">{error}</span>}
			<button
				type="button"
				data-testid="fullscreen-toggle"
				aria-label={label}
				aria-pressed={active}
				title={supported ? `${label}${active ? " (Esc)" : ""}` : "Fullscreen is not available in this browser"}
				disabled={!supported || pending}
				onClick={() => void toggle()}
				className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
			>
				{active ? <Minimize2Icon className="size-4" aria-hidden /> : <Maximize2Icon className="size-4" aria-hidden />}
			</button>
		</div>
	);
}
