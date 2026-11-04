"use client";

import { createContext, useContext, useMemo, type ComponentProps, type ReactNode } from "react";
import NextLink from "next/link";
import { useRouter as useNextRouter } from "next/navigation";
import { courseUrlForId } from "@/lib/course-client";
import type { CourseInfo } from "@/src/core";
export { usePathname, useSearchParams, useParams } from "next/navigation";

const CourseContext = createContext<Pick<CourseInfo, "id" | "name" | "readOnlyLibrary">>({ id: "legacy", name: "Existing course", readOnlyLibrary: true });
export function CourseProvider({ course, children }: { course: Pick<CourseInfo, "id" | "name" | "readOnlyLibrary">; children: ReactNode }) {
	return <CourseContext.Provider value={course}>{children}</CourseContext.Provider>;
}
export function useCourse() { return useContext(CourseContext); }

export function useRouter(): ReturnType<typeof useNextRouter> {
	const router = useNextRouter();
	const { id } = useCourse();
	return useMemo<ReturnType<typeof useNextRouter>>(() => ({ ...router,
		push: (href, options) => router.push(courseUrlForId(href, id), options),
		replace: (href, options) => router.replace(courseUrlForId(href, id), options),
		prefetch: (href, options) => router.prefetch(courseUrlForId(href, id), options),
	}), [router, id]);
}

export default function CourseLink(props: ComponentProps<typeof NextLink>) {
	const { id } = useCourse();
	const href = typeof props.href === "string" ? courseUrlForId(props.href, id)
		: (() => {
			const query = typeof props.href.query === "string" ? Object.fromEntries(new URLSearchParams(props.href.query)) : { ...props.href.query };
			if (query.course !== undefined && query.course !== id) throw new Error("Conflicting course selection");
			return id === "legacy" ? props.href : { ...props.href, query: { ...query, course: id } };
		})();
	return <NextLink {...props} href={href} />;
}
