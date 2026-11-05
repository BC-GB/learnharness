/** Navigation metadata only. Course content never appears in this registry. */
export interface CourseInfo { id: string; name: string; createdAt: string; readOnlyLibrary: boolean }
export const DEFAULT_COURSE_ID = "legacy";
export function isCourseId(value: unknown): value is string {
	return typeof value === "string" && (value === DEFAULT_COURSE_ID || /^course_[a-f0-9]{32}$/.test(value));
}
export function courseName(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const name = value.trim();
	return name.length > 0 && name.length <= 80 && !/[\x00-\x1f\x7f]/.test(name) ? name : null;
}
