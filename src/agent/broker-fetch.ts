import http from "node:http";
import { Readable } from "node:stream";
import { BROKER_REQUEST_MAX_BYTES, BrokerRequestBodyError, prepareBrokerRequestBody } from "./broker-request-body.ts";

export function brokerEnabled(): boolean { return process.env.LH_BROKER_MODE === "1"; }

// A rejected fetch is wrapped by the SDK as "Connection error" and retried.
// A nonretryable API-shaped response preserves the actionable local failure.
function requestError(message: string, status: number): Response {
	return Response.json({ error: { message, type: "invalid_request_error", code: "broker_request_invalid" } }, { status });
}

/** No provider credentials or app-supplied headers cross this socket.
 * The deployment must deny network access independently of this adapter. */
export const brokerFetch: typeof fetch = async (input, init) => {
	init?.signal?.throwIfAborted();
	const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
	if (url !== "https://api.openai.com/v1/responses" || init?.method !== "POST" || typeof init.body !== "string") {
		return requestError("The approval broker accepts only OpenAI Responses POST requests", 400);
	}
	let body: Buffer;
	try { body = await prepareBrokerRequestBody(init.body, init.signal); }
	catch (error) {
		if (error instanceof BrokerRequestBodyError) return requestError(error.message, error.status);
		throw error;
	}
	init.signal?.throwIfAborted();
	if (body.length > BROKER_REQUEST_MAX_BYTES) return requestError("The model request exceeds the 1 MiB request limit. No request was sent.", 413);
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
