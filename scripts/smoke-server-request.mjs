/** Test-only requests to the disposable server. Never forward its capability. */
export function createSmokeServerRequest(url, headers = {}) {
	const server = new URL(url);
	if (server.protocol !== "http:" || server.hostname !== "127.0.0.1" || !server.port || server.username || server.password || server.pathname !== "/" || server.search || server.hash) {
		throw new Error("Smoke server must be an explicit loopback origin");
	}
	return (route, options = {}) => {
		const target = new URL(route, server);
		if (target.origin !== server.origin || target.username || target.password) throw new Error("Smoke request escaped the server origin");
		const merged = new Headers(options.headers);
		for (const [name, value] of new Headers(headers)) merged.set(name, value);
		return fetch(target, { ...options, headers: merged, redirect: "error" });
	};
}
