# Original interface through an isolated browser

This deployment runs the original Next app and its Chromium browser in separate
containers with `network_mode: none`. The laptop receives a framebuffer and sends
keyboard/mouse input through a capability-authenticated noVNC gateway. App HTML,
JavaScript, generated figures and quiz UI execute in the Docker browser, not in
the laptop browser. This is not a replacement teaching interface.

## Boundaries

- App: only approved course/state and restricted broker/app IPC volumes. No host
  folders, provider credentials, approval socket, Docker socket or network adapter.
- Browser: only app IPC and its framebuffer socket. No course/state/credentials,
  host display, clipboard, device or Docker mounts. Managed policies block other
  origins, downloads, sign-in/sync and device/clipboard permissions. x11vnc uses
  a Unix socket and `-nosel`; no VNC TCP port or file transfer is enabled.
- Gateway: fixed viewer assets, noVNC and three bounded data operations (selected
  PDF/text import, session titles, Markdown export), separate private capability,
  strict Host/Origin checks, HttpOnly SameSite cookie, no arbitrary app/API/file proxy.
  Its separate firewall namespace denies new outbound connections.
- Subscription sign-in and optional outgoing-request review remain in the
  independent broker interface. The app/browser never receive account tokens.

Chromium requires its namespace and seccomp-BPF sandboxes. The deployment uses
the narrowly extended [Chromium seccomp profile](../chromium/README.md), with no
added container capabilities and no sandbox-disabling fallback. Docker remains
the outer boundary; neither layer proves immunity to kernel/runtime escapes.

## Build and run

Build the signed-distribution browser base with `Dockerfile.browser-base`, then
`Dockerfile`. Review and pin each resulting image ID in deployment configuration.
The original app uses local font assets, so its production build is offline.
Set `LH_VISUAL_ISOLATED=1` for the original app build and Unix-only custom server;
it uses the full Next installation rather than Next's standalone server output.
Overlay `compose.visual.yaml` on the existing broker deployment. Preserve existing
course/account/state volumes. The only new host port is loopback 3189 for the
trusted pixel viewer; the original HTTP server is never published on the host.
Copy `security/chromium/seccomp.json` to `chromium-seccomp.json` beside the first
deployment Compose file and include its hash in the deployment baseline.

Scrolling uses bounded pixel deltas, including fractional trackpad movement,
over a capability-authenticated `/scroll` WebSocket. The trusted viewer scales
coordinates to the framebuffer, coalesces input at display cadence, permits one
unacknowledged request, drops stale input, and releases the channel in hidden
tabs. Nested-pane scrolling is handled by Chromium's normal wheel input.
Low-delay XDamage updates and minimal loopback compression reduce display lag;
the viewer still receives pixels, so it cannot guarantee native display latency.

`scroll-browser.mjs` owns Chromium's anonymous debugging pipes inside the browser
container. Those pipes are not mounted, proxied or published. The separate
`scroll.sock` accepts only `{seq,x,y,dx,dy}`: finite bounded numbers, increasing
sequence, at most four connections and 180 requests/second globally. It returns
only readiness and input acknowledgements. It does not accept CDP commands,
JavaScript, URLs, paths, target IDs, keyboard or button events. Fixed internal
methods select only the app origin, validate its window/viewport, recheck its
origin and connection freshness after async setup, and dispatch a wheel event.
No app/session content is returned through this channel. TCP debugging remains
disabled in production; no new host port, mount, capability or sandbox exception
is required. The gateway applies the same Host/Origin/cookie checks as VNC.

If the precision channel is unavailable, the existing VNC wheel path remains.
`patch-novnc-wheel.py` preserves steps and fractional remainders for that fallback,
with a 20-step per-event ceiling. It fails builds if the distro handler changes.

Use `/#CAPABILITY` to establish the viewer session. The fragment is removed from
history, and the capability is not stored in local/session storage. This grants
screen/input access, not automatic provider dispatch or spending permission.

`LH_VISUAL_START_PATH` optionally selects `/chat/ID` for a prepared lesson.
`LH_VISUAL_TEST_DEBUG=1` exposes CDP on browser-container loopback for disposable
synthetic tests only. It MUST remain `0` in the deployed user browser. Never
publish its port or mount personal browser profiles.

## Verification required before deployment

Verify original lesson navigation, quiz submission, mathematical formatting and
static visual cards using the mock provider. Exercise mouse input through noVNC,
not just an HTTP200 or WebSocket connection. Inspect screenshots. Test access
rejection, hostile content, no external browser requests, no host/credential
mounts, raw network denial, restart persistence and disabled production debugging.
Keep account/course data untouched until the candidate passes these checks.

`mock-provider.mjs` and `Dockerfile.mock` are synthetic fixtures; they are not
copied into the production browser/gateway image and must never replace a real
provider silently. PDF and demo execution requires the separate networkless
`security/render-worker/compose.yaml` worker; without it those tools refuse.

The viewer's **Files** control imports only files explicitly selected by the
user into the original knowledge-graph pipeline. It does not mount a laptop
directory or expose a general file API. Import is model-backed and subject to
the same broker permission as teaching. A fixed Unix transfer service validates
routes, limits request/response sizes, and discards upstream headers. Export
returns session Markdown as a text attachment, or a PNG of the displayed screen;
generated HTML/SVG downloads remain blocked. Treat exported text as untrusted.
The app cannot trigger host downloads or open the host file picker itself.

Refresh uses the existing HttpOnly cookie. **Actual size** avoids shrinking the
framebuffer text; **Fit to window** restores scaling. Account settings opens the
separate trusted broker page. Research and dictation require their original
third-party providers and remain unavailable in this subscription-only setup.

Explicit subscription-direct deployments set LH_BROKER_REQUEST_POLICY=subscription-direct on the trusted broker. New subscription requests then dispatch without per-request review; account identity, sign-in, plan permission and the spending policy are still checked before dispatch and after credential resolution. This option cannot enable billable API-key mode, and never replays old queued requests. Without individual payload review, the app can send its accessible course/session data to the permitted provider. File/network/credential containment remains unchanged.
