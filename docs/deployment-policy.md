# Secure deployment defaults

All page, asset and API routes require a server capability. A missing or short `LH_DESKTOP_API_SECRET` denies access, including `next dev` and `next start`. Packaged desktop supplies its existing random per-launch capability. Web deployment requires an independently authenticated HTTPS gateway that strips any client-supplied `x-learnharness-desktop` header and injects the server capability only after authentication. Generate at least 32 random bytes, represented as 64 hexadecimal characters. Keep the secret server-side; never put it in client code or a URL. The server must not be reachable around that gateway. Default npm web commands bind only to 127.0.0.1.

All page and asset routes require the capability too, including server-rendered chat data and RSC requests. The desktop shell supplies it only for its registered native main frame on the exact app origin; the first root navigation has a narrowly scoped bootstrap rule. A browser deployment needs an authenticated gateway that injects the capability after authenticating the user. Do not put the capability in URLs or browser JavaScript.


The OAuth callback always binds to 127.0.0.1. `LH_CALLBACK_BIND` is no longer supported. `LH_CALLBACK_PORT` can select a port; otherwise it is ephemeral. Remote subscription sign-in requires a separate supported authentication design; do not expose a plaintext callback.

## Source library

Set `LH_SOURCE_ROOT` to a dedicated read-only directory containing only approved learning materials. Without it, model file tools deny access. Relative paths resolve inside that directory; traversal and real-path escapes are rejected. Do not use a home directory or credential directory as the library. Keep it immutable while the app runs: these application checks are not an OS boundary against another process changing files. Use a read-only container mount and do not mount unrelated host folders.

Read, grep, web-page and search results mark source material as untrusted data. This is model guidance, not a guarantee against prompt injection; permissions and isolation must hold even if the model follows hostile instructions.

Reads are limited before buffering to 8 MiB and regular files only. Grep has a 2 MiB input limit. File growth cannot bypass the byte cap. Regex search supports anchors, character classes and alternatives; repetition, groups and backreferences are rejected explicitly. Literal search supports all characters. Globs have length and complexity limits.

## Network research

Page retrieval is denied unless the server sets `LH_RESEARCH_ALLOWED_HOSTS` to a comma-separated list of approved exact hostnames. Wildcards and implicit subdomain grants are not supported; redirects require their own host grant. Approved hosts can still receive data in URLs, so grant only destinations intended to receive learning context. Research page retrieval accepts HTTPS on port 443 only, without URL credentials. It rejects non-public IPv4 addresses, IPv6 literals, private DNS results and mixed public/private answers. DNS results are pinned to the socket while TLS still verifies the original hostname. Each redirect is checked again; at most three redirects are followed. Actual streamed bodies are capped at 5 MiB regardless of Content-Length. Compressed responses and third-party reader fallback are unsupported. IPv6-only destinations are currently unsupported.

`LH_DISABLE_RESEARCH=1` additionally disables search and research jobs. Search-provider API calls remain separate from page retrieval; configure only trusted providers.

## Removed execution paths

This fork does not run model-authored HTML in a server browser. The Electron browser-service entry point refuses startup, and there is no system-Chrome fallback. Static SVG rendering remains, with input/dimension limits and no external or embedded resource references. Raw HTML/SVG export remains unavailable.

Raw PDF downloading, parsing and rendering are disabled in every configuration. There is no environment override. Supply prepared text and images in the approved library instead. Restoring these features requires a separately isolated renderer/parser with enforced process, memory, time and network limits; toggling an environment variable is not a supported restoration path. Existing PDF and browser-disable variables are therefore no longer necessary.

## Release and diagnostics

The release workflow is manual, unsigned and artifact-only. It has read-only repository permissions, disables checkout credential persistence, and receives no signing/notarization secrets or publication token. It does not create or publish GitHub releases. Signing and publication need a separate reviewed workflow that does not execute repository or dependency build code with those credentials.

Raw provider-event recording requires exactly `LH_PROVIDER_EVENTS=1`. Leave it unset; these diagnostic files can contain conversation and request content. `LH_DISABLE_SUBSCRIPTION_AUTH=1` blocks subscription authentication, and `LH_IGNORE_ENV_KEYS=1` ignores inherited API keys. `NEXT_TELEMETRY_DISABLED=1` disables Next.js telemetry.

## Limits

These changes address specific application attack paths, not arbitrary malicious code running with the app's permissions. Use non-root execution, a read-only filesystem, no Docker socket, resource limits and independent network restrictions. Allowed provider requests can contain conversation history and approved document text. Only provide credentials and documents intended for that provider. Passing tests does not certify that the application or its dependencies are malware-free.

## Upstream compatibility

The 0.4.1 source/folder organization, bounded multipart imports, question recovery and cache preferences retain these restrictions. PDF imports are refused before extraction and source registration, including PDFs renamed as text. Leading home (`~`) paths are explicitly rejected; use the approved source root. Background diagnostic captures remain off unless `LH_BACKGROUND_CAPTURE` selects a role or `all`; enabling them stores conversation content locally and does not enable PDF processing. Leave this variable unset.

Remote desktop update checks, downloads and installations are disabled, including manual checks and `LH_UPDATE_FEED` overrides. Updating this fork requires another audited source merge and build; upstream release binaries must not overwrite its protections.
