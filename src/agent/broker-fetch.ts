import http from "node:http";
import { Readable } from "node:stream";

export function brokerEnabled(): boolean { return process.env.LH_BROKER_MODE === "1"; }

/** No provider credentials or app-supplied headers cross this socket.
 * The deployment must deny network access independently of this adapter. */
export const brokerFetch: typeof fetch = async (input, init) => {
	const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
	if (url !== "https://api.openai.com/v1/responses" || init?.method !== "POST" || typeof init.body !== "string") {
		throw new Error("The approval broker accepts only OpenAI Responses POST requests");
	}
	const body = Buffer.from(init.body);
	if (body.length > 1024 * 1024) throw new Error("Broker request exceeds 1 MiB");
	return new Promise<Response>((resolve, reject) => {
		const req = http.request({ agent: false, socketPath: "/broker/request.sock", path: "/v1/responses", method: "POST",
			headers: { "content-type": "application/json", "content-length": body.length }, signal: init.signal ?? undefined }, reply => {
			const headers = new Headers({ "content-type": reply.headers["content-type"] ?? "application/json" });
			resolve(new Response(Readable.toWeb(reply) as ReadableStream<Uint8Array>, { status: reply.statusCode ?? 502, headers }));
		});
		req.on("error", reject);
		req.setTimeout(660_000, () => req.destroy(new Error("Broker approval or response timed out")));
		req.end(body);
	});
};
