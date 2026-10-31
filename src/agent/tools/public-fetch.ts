import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request } from "node:https";

export function publicIPv4(address: string): boolean {
	if (isIP(address) !== 4) return false;
	const [a, b, c] = address.split(".").map(Number);
	return !(a === 0 || a === 10 || a === 127 || a! >= 224 ||
		(a === 100 && b! >= 64 && b! <= 127) || (a === 169 && b === 254) ||
		(a === 172 && b! >= 16 && b! <= 31) || (a === 192 && (b === 168 || b === 0 || b === 2 || (b === 88 && c === 99))) ||
		(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
		(a === 203 && b === 0 && c === 113));
}

export function publicURL(value: string, allowedHosts = process.env.LH_RESEARCH_ALLOWED_HOSTS ?? ""): URL {
	const url = new URL(value);
	if (url.protocol !== "https:" || (url.port && url.port !== "443") || url.username || url.password)
		throw new Error("Research requires HTTPS on port 443 without URL credentials.");
	if (url.hostname === "localhost" || url.hostname.endsWith(".localhost") || url.hostname.endsWith(".local") || url.hostname.startsWith("[") ||
		(isIP(url.hostname) && !publicIPv4(url.hostname))) throw new Error("Non-public destination denied.");
	// Exact hostnames only; an empty deployment policy denies all page fetching.
	// This policy is server-owned, never accepted as a model/tool argument.
	const allowed = allowedHosts.split(",").map(host => host.trim().toLowerCase()).filter(Boolean);
	if (!allowed.includes(url.hostname)) throw new Error("Research destination is not in LH_RESEARCH_ALLOWED_HOSTS.");
	return url;
}

/** Pin DNS results into the socket lookup; never resolve again during connect.
 * HTTPS identity is still checked against the original hostname. No proxy,
 * cookies, credentials, automatic redirects, decompression or reader fallback. */
export async function fetchPublic(urlString: string, maxBytes: number): Promise<{ url: string; status: number; contentType: string; bytes: Buffer }> {
	const signal = AbortSignal.timeout(30_000);
	let url = publicURL(urlString);
	for (let hop = 0; hop <= 3; hop++) {
		const records = await lookup(url.hostname, { all: true, family: 4 });
		signal.throwIfAborted();
		if (!records.length || records.some(r => !publicIPv4(r.address))) throw new Error("Non-public destination denied.");
		const pinned = records[0]!.address;
		const result = await new Promise<{ status: number; location?: string; contentType: string; bytes: Buffer }>((resolve, reject) => {
			const req = request(url, {
				agent: false, signal, family: 4,
				lookup: (_host, options, callback) => {
					if (options.all) callback(null, [{ address: pinned, family: 4 }]);
					else callback(null, pinned, 4);
				},
				headers: { accept: "text/html,text/plain,application/pdf", "accept-encoding": "identity" },
			}, res => {
				const status = res.statusCode ?? 0;
				const contentType = String(res.headers["content-type"] ?? "");
				if ([301, 302, 303, 307, 308].includes(status)) {
					resolve({ status, location: res.headers.location, contentType, bytes: Buffer.alloc(0) });
					res.destroy(); return;
				}
				if (status < 200 || status >= 300 || Number(res.headers["content-length"] ?? 0) > maxBytes ||
					(res.headers["content-encoding"] && res.headers["content-encoding"] !== "identity")) {
					reject(new Error("Unsupported, oversized or unsuccessful research response.")); res.destroy(); return;
				}
				let size = 0;
				const chunks: Buffer[] = [];
				res.on("data", (chunk: Buffer) => {
					size += chunk.length;
					if (size > maxBytes) { reject(new Error("Response too large.")); res.destroy(); }
					else chunks.push(chunk);
				});
				res.on("error", reject);
				res.on("end", () => resolve({ status, contentType, bytes: Buffer.concat(chunks, size) }));
			});
			req.on("error", reject); req.end();
		});
		if ([301, 302, 303, 307, 308].includes(result.status)) {
			if (!result.location || hop === 3) throw new Error("Invalid or excessive redirects.");
			url = publicURL(new URL(result.location, url).href); continue;
		}
		return { ...result, url: url.href };
	}
	throw new Error("Excessive redirects.");
}
