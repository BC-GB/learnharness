import type { Metadata } from "next";
import localFont from "next/font/local";
import "katex/dist/katex.min.css";
import "./globals.css";
import { AppShell, SidebarProvider } from "@/components/sidebar";
import { ActivityProvider } from "@/components/activity-dock";
import { ServerEventsProvider } from "@/components/server-events";
import { ResponseNotifications } from "@/components/response-notifications";
import { AppearanceProvider } from "@/components/settings/appearance";
import UpdateBanner from "@/components/update-banner";
import { CourseProvider } from "@/components/course-navigation";
import { coursePage, currentCourse } from "@/src/server";
import { PluginsProvider } from "@/components/plugins";
import { readThemeBoot } from "@/src/server";

// Chrome = JetBrains Mono, teaching prose = Source Sans 3, titles = CMU
// Serif (the bundled lh-cmu @font-face in globals.css — no CDN).
const ui = localFont({ src: "../public/fonts/jetbrains-mono.ttf", variable: "--font-jetbrains", display: "swap" });
const prose = localFont({ src: "../public/fonts/source-sans-3.ttf", variable: "--font-sans3", display: "swap" });

export const metadata: Metadata = {
	title: "Learning Harness",
	description: "A teacher agent with a memory — sessions, quizzes, and a knowledge graph of what you know.",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return coursePage(() => {
		const { appearance, theme, vars } = readThemeBoot();
		return (
		<html lang="en" data-course-id={currentCourse()!.id} className={`${theme.mode} ${ui.variable} ${prose.variable}`} style={vars as React.CSSProperties} suppressHydrationWarning>
			<body className="min-h-dvh antialiased">
			<CourseProvider course={{ id: currentCourse()!.id, name: currentCourse()!.name, readOnlyLibrary: currentCourse()!.id === "legacy" }}>
			{/* The notification channel rides OUTSIDE everything: sidebar, dock,
				 and pages all subscribe as the polls retire (push S3, 2026-10-02). */}
			<ServerEventsProvider>
				<ResponseNotifications />
				<PluginsProvider>
					<AppearanceProvider initialAppearance={appearance} initialTheme={theme}>
						<SidebarProvider>
							<ActivityProvider>
								<AppShell>{children}</AppShell>
							</ActivityProvider>
						</SidebarProvider>
					</AppearanceProvider>
				</PluginsProvider>
			</ServerEventsProvider>
			{/* Auto-update banner (Wave C): fixed card, Electron-only pushes. */}
			<UpdateBanner />
			</CourseProvider>
		</body>
		</html>
	);
	});
}
