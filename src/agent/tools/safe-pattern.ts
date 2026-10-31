/** Repetition, groups and backreferences are outside the supported syntax. */
export function validateSafeRegex(pattern: string): void {
 if (pattern.length > 1024) throw new Error("Search pattern exceeds 1024 characters.");
 if (/[()*+?{}]|\\[1-9k]/.test(pattern)) throw new Error("Regex repetition, groups and backreferences are unsupported; use literal search.");
}

export function literalPattern(pattern: string, ignoreCase: boolean): { test(text: string): boolean } {
 if (pattern.length > 1024) throw new Error("Search pattern exceeds 1024 characters.");
 const needle = ignoreCase ? pattern.toLowerCase() : pattern;
 return { test: text => (ignoreCase ? text.toLowerCase() : text).includes(needle) };
}

/** Validation must precede construction. Literal searches never compile regex. */
export function compileSafePattern(pattern: string, literal: boolean, ignoreCase: boolean): { test(text: string): boolean } {
 if (literal) return literalPattern(pattern, ignoreCase);
 validateSafeRegex(pattern);
 return new RegExp(pattern, ignoreCase ? "i" : undefined);
}
