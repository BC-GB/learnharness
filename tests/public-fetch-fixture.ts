import dns from "node:dns/promises";
import https from "node:https";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { syncBuiltinESMExports } from "node:module";

/** Synthetic transport for integration tests; never opens a socket. */
export function fakePublicFetch(respond: (url: string) => Response | Promise<Response>): () => void {
	const originalLookup = dns.lookup, originalRequest = https.request;
	dns.lookup = (async () => [{ address: "8.8.8.8", family: 4 }]) as unknown as typeof dns.lookup;
	https.request = ((url: URL, _options: unknown, callback: (response: Readable) => void) => {
		const req = new EventEmitter() as EventEmitter & { end: () => void };
		req.end = () => {
			void Promise.resolve().then(() => respond(url.href)).then(async response => {
				const bytes = Buffer.from(await response.arrayBuffer());
				callback(Object.assign(Readable.from([bytes]), { statusCode: response.status, headers: Object.fromEntries(response.headers.entries()) }));
			}).catch(error => req.emit("error", error));
		};
		return req;
	}) as unknown as typeof https.request;
	syncBuiltinESMExports();
	return () => { dns.lookup = originalLookup; https.request = originalRequest; syncBuiltinESMExports(); };
}
