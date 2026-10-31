import { constants } from "node:fs";
import { open } from "node:fs/promises";

/** Bound the actual read, not merely a prior stat or the returned text. */
export async function readBoundedFile(file: string, limit: number, signal?: AbortSignal): Promise<Buffer> {
	signal?.throwIfAborted();
	const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
	try {
		const stat = await handle.stat();
		if (!stat.isFile()) throw new Error("Only regular files can be read.");
		if (stat.size > limit) throw new Error("Source file exceeds the input size limit.");
		const buffer = Buffer.alloc(Math.min(limit + 1, stat.size + 1));
		let count = 0;
		while (count < buffer.length) {
			signal?.throwIfAborted();
			const { bytesRead } = await handle.read(buffer, count, buffer.length - count, count);
			if (!bytesRead) return buffer.subarray(0, count);
			count += bytesRead;
		}
		throw new Error("Source file exceeds the input size limit.");
	} finally { await handle.close(); }
}
