# Approval broker

Broker mode integrates at LearnHarness's model factory and normal chat admission.
It does not store an API key in LearnHarness. Only OpenAI Responses models are
available in this mode. The app sends complete request bytes through a Unix
socket and receives the provider's streaming response after independent approval.

## Boundaries

- App: `network_mode: none`, non-root, read-only image, no capabilities, no host
  folders or Docker socket. Mount only `/broker` read-only plus its own app state
  and an explicitly approved read-only course library.
- Broker: separate container and PID/mount namespaces. Its control socket and
  ledger must never be mounted into the app. The app-facing socket has no
  approval or inspection API.
- Only the broker may hold a future provider key, as a read-only secret file.
  The app adapter discards SDK headers and replaces its local placeholder key.
- Each request, including background jobs and tool-loop follow-ups, requires a
  new approval of its complete bytes. Domain permission is not payload approval.
- Requests expire after ten minutes. Rejection, timeout, disconnect, restart,
  storage failure and malformed approvals fail closed. A consumed request is
  never automatically replayed. Failed provider requests consume approval too.
- Queue: 16 pending requests, 1 MiB each. Response: 16 MiB and two-minute deadline.
  Ledger stops admitting requests at 1,024 records; maintenance is a trusted
  operator task while stopped. Pending payloads are private data; completed
  records retain hashes/status only. This is not forensic secure deletion.

## Review and operate

Run the trusted control tool **inside the broker container**, never the app:

```text
node admin.mjs list
node admin.mjs show REQUEST_ID
node admin.mjs approve REQUEST_ID SHA256
node admin.mjs reject REQUEST_ID SHA256
```

`show` prints the exact UTF-8 body and its base64 bytes as JSON (terminal control
characters are escaped), destination and hash. Inspect the entire request,
including source excerpts, tools, metadata and background context. Approve the
hash from that review. Do not approve based only on a model-generated summary.
There is deliberately no automatic approval of ordinary learner requests.

## Restricted browser interface

`compose.mock.yaml` includes an independent text-only browser interface and an
app-side Unix IPC adapter. The browser receives only the review service's fixed
HTML/JS/CSS. App messages, model names and request bodies are rendered with
`textContent`; app scripts, HTML, images, SVG, links and embeds are never rendered.
The view requires a separate random access capability and exact loopback Host and
Origin checks. CSP denies external connections, frames, images and forms.
The view has no app credential file; the app has no view capability, control
socket, provider key or network interface. No dictation or native app UI is exposed.
This restricted interface supports text lessons, saved sessions, model selection
and exact request review. It does not reproduce the original rich UI or quiz controls.

The supplied deployment remains MOCK ONLY and creates new isolated state. Do not
mount existing personal state or enable live billing as part of a smoke test.
After an explicitly authorized launch, the private URL is
`http://127.0.0.1:3188/#CAPABILITY`; retrieve the capability from the trusted view's
`/view-secret/token`, never from the app. The fragment is removed from browser
history on load and kept in page memory, not persistent browser storage. Refreshing
requires the private link again. Do not share it.

The view uses a dedicated `view-net` network namespace. Only its loopback-bound
host port is published. Before the view starts, the namespace installs default
DROP rules for IPv4 and IPv6; only inbound HTTP, its replies, and an internal
HTTP health probe are allowed. DNS and new outbound connections are denied.
The bootstrap drops its capabilities before becoming healthy. The view itself
runs without capabilities. This does not modify the host's firewall.

Build `Dockerfile.network` from an independently reviewed, cached Linux image
containing `iptables`, `ip6tables`, `setpriv`, and `sleep`, using
`--build-arg FIREWALL_IMAGE=LOCAL_REVIEWED_IMAGE`. Set `VIEW_NET_IMAGE` to the
resulting image ID, alongside pinned `APP_IMAGE` and `BROKER_IMAGE`. No package
installation or download occurs in that Dockerfile. A failed bootstrap blocks
view startup. App, broker and view readiness checks avoid startup races.

After restarting `view-net`, recreate the view to join its current namespace:
`docker compose -f security/broker/compose.mock.yaml up -d --wait --force-recreate view`.
Wait for healthy status before reopening the private link. Do not enable automatic
restart for this fixture. Pending approvals are never automatically granted.

## Real-browser regression test

Use an existing Chromium executable and Python Playwright installation. The
runner uses a fresh headless profile, synthetic volumes, the mock provider and
unique temporary Docker resources; it never opens an existing browser profile.

```text
python security/broker/test-real-browser.py --app-image sha256:APP_ID --node-image node@sha256:NODE_DIGEST --firewall-image sha256:FIREWALL_ID --chromium /path/to/chrome --evidence-dir /private/path/browser-evidence
```

The test covers private access, approval/rejection, request switching, saved
lessons, app and namespace restart, hostile app output, actual browser CSP and
cross-origin enforcement, outbound denial and failed firewall initialization.
A local canary is allowed through the test interceptor so CSP denial is tested
by Chromium itself. Results and screenshots stay in the supplied evidence
directory. These checks were run with Chromium 151; other browser engines and
authenticated live-provider behavior are not covered.

The lower-level HTTP integration runner uses the same reviewed images:
`python security/broker/test-view-stack.py --app-image sha256:APP_ID --node-image node@sha256:NODE_DIGEST --firewall-image sha256:FIREWALL_ID --evidence /private/path/view-results.json`.

## Offline test

Use only locally cached, reviewed image digests. No downloads, keys or billing
are needed. `compose.test.yaml` is deliberately a synthetic fixture, NOT a
production Compose file. It publishes no ports and has an internal mock-only
network. The app has no network and only a read-only socket volume.

```text
python security/broker/test-containers.py --app-image sha256:APP_ID --node-image node@sha256:NODE_DIGEST --evidence /private/path/results.json
```

The fixture approves only payloads containing its synthetic marker. Never adapt
its automatic approval loop to real course or session data. It creates a unique
project, checks model-factory streaming and the ordinary chat route, verifies
persisted lesson output, replay rejection and restart, then removes only its own
fixture containers/volumes/network. The production installation is untouched.
Run `node --import tsx --test security/broker/broker.test.mjs` with writable
synthetic `/tmp` and `/broker` inside a network-disabled container for adversarial
protocol tests. Run the normal repository test suite as well.

## Live mode remains locked

### ChatGPT subscription mode

`compose.subscription.yaml` overlays the mock Compose file. It selects a separate
`subscription` mode with no API key and no automatic switch to paid API mode.
It implements the official [open-source Sign in with ChatGPT flow](https://developers.openai.com/siwc/token-sharing-open-source/sign-in).
The broker validates PKCE/state/nonce, the ID-token signature, issuer, audience,
expiry and account identity. Account registrations and rotating tokens live in
an owner-only broker volume that is not mounted in the app or browser gateway.
No password, browser cookie, existing Codex credential file or ChatGPT conversation
history is imported. Sign-out attempts remote revocation and clears local tokens;
failure to confirm remote revocation is explicitly reported.

The app and broker have `network_mode: none`. The broker's read-only egress socket
connects to a separate daemon that permits only `auth.openai.com:443` and
`api.openai.com:443`, rejects private/reserved IPv4 addresses, and does not support
IPv6 or caller-selected ports. TLS runs end-to-end from the broker with certificate
verification. The daemon has no credentials or app/course volumes. Its own DNS
resolution and Internet interface remain part of the trusted deployment boundary.

Account setup is available at `/account.html#CAPABILITY` while the learning app
remains stopped. After deployment validation, start only `init`, `egress`, `broker`,
`view-net`, then `view` with `--no-deps` (otherwise Compose starts the app dependency).
Wait for each health check before opening the private setup link. No startup
script should remove an existing installation's security hold automatically.

**Sign-in is not spending authorization.** OpenAI documents usage of both plan
allowance and credits; the documented OAuth scopes do not establish an
included-allowance-only guarantee. The broker refuses inference until a trusted
operator independently verifies the account's paid-credit controls and creates
`/policy/plan-only.json` in the separate policy volume. Neither app nor browser has
an unlock endpoint. The policy is bound to the validated account/client hash,
has a verification/evidence hash, and expires within 24 hours. Recheck the account
settings if they change; this file is an operator attestation, not a replacement
for provider-enforced spending limits. If those limits cannot be verified, leave
inference locked. Never create this file merely because OAuth consent succeeded.

Policy schema (values must come from verification, not an inference request):
`version: 1`, `accountKey` from trusted subscription status,
`paidCreditsDisabled: true`, `evidenceSha256`, `verifiedAt` and `expiresAt` as UTC
epoch milliseconds. Store it with mode `0600`; mount `/policy` read-only in broker.
There is deliberately no automatic policy creation in the supplied deployment.

Subscription requests are normalized to the documented HTTP contract **before**
hashing and review: unsupported sampling/state fields are omitted, system messages
become developer messages and local function tools use a namespace. The review
shows the exact transmitted bytes. Account changes invalidate pending requests
and terminate active upstream connections. Models come from the selected account's
catalog, intersected with models supported by this app build. Quota, authorization
and transport errors never trigger paid fallback or automatic reapproval.

Run the same real-browser runner with `--subscription-fixture` for a fake signed
identity and mock inference. This additionally tests account setup while the app
is stopped, the independent spending lock, model selection and logout. The test
image alone receives `mock-subscription.mjs`; the production Dockerfile excludes it.
`subscription-transport.test.mjs` creates an ephemeral TLS certificate with local
OpenSSL and tests trust rejection, a verified tunnel, redirects and response limits
without Internet access. It does not disable TLS certificate verification.

These are offline/mock validations. A real user sign-in, verified provider-side
credit controls, live model/tool compatibility and a completed real lesson remain
explicit deployment gates. See the official [account/security guide](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
and [preview restrictions](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).

### Separate API-key mode

Default upstream is the isolated mock. Live mode requires both `LH_BROKER_UPSTREAM=live`
and the explicit `LH_BROKER_ALLOW_LIVE=I_AUTHORIZE_BILLABLE_OPENAI_REQUESTS` deployment
acknowledgement, plus `/run/secrets/openai-key`. These are trusted operator settings,
not an app API. This work does not authorize setting them or supplying a real key.
The fixed live endpoint is HTTPS `api.openai.com/v1/responses`, certificate verification
on, fresh broker-owned headers, no redirects, remote provider tools rejected.
No authenticated live-provider compatibility, billing, provider retention or
production browser verification is claimed by mock tests.

The containment assumes a trusted Docker host/runtime and broker image. It does
not prove dependency innocence or rule out unknown kernel, runtime or hardware
escapes. A user or administrator can deliberately bypass the deployment controls.
