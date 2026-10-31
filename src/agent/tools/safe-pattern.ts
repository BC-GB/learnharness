/** Deliberately restricted regex syntax: no repetition, groups or backreferences.
 * Literal search supports every character. Reject unsupported regex explicitly. */
export function compileSafePattern(pattern: string, literal: boolean, ignoreCase: boolean): { test(text: string): boolean } {
	if (pattern.length > 1024) throw new Error("Search pattern exceeds 1024 characters.");
	if (literal) {
		const needle = ignoreCase ? pattern.toLowerCase() : pattern;
		return { test: text => (ignoreCase ? text.toLowerCase() : text).includes(needle) };
	}
	if (/[()*+?{}]|\\[1-9k]/.test(pattern)) throw new Error("Regex repetition, groups and backreferences are unsupported; use literal search.");
	return new RegExp(pattern, ignoreCase ? "i" : undefined);
}
