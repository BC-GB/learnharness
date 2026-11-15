/** Read-only text sources in the host-selected course. No host paths or credentials. */
export interface PluginLibraryFile { path: string; name: string; bytes: number }
export interface PluginLibrary {
	/** Bounded metadata only. Patterns use the native file-tool glob syntax. */
	list(options?: { pattern?: string; limit?: number }): Promise<{ name: string; files: PluginLibraryFile[]; truncated: boolean }>;
	/** A relative library path; all native source/policy/alias guards apply again.
	 * Text files only, at most 512 KiB/file and 512 Ki characters per response.
	 * Offsets are UTF-16 characters. This does not OCR or convert PDFs. */
	read(options: { path: string; offset?: number; limit?: number }): {
		path: string; text: string; characters: number; offset: number; nextOffset: number | null; sha256: string;
	};
}
