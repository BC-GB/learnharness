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
- Gateway: fixed viewer assets and noVNC only, separate private capability,
  strict Host/Origin checks, HttpOnly SameSite cookie, no app/API/file proxy.
  Its separate firewall namespace denies new outbound connections.
- Subscription sign-in and exact outgoing-request approval remain in the
  independent broker interface. The app/browser never receive account tokens.

Chromium's native sandbox does not run under the current Docker capability and
no-new-privileges restrictions. No additional privileges are granted to make it
run; Chromium uses `--no-sandbox` inside the restricted container. Docker is the
outer boundary, not a proof against kernel/runtime escapes. Do not claim native
Chromium sandbox protection or suppress this limitation in assurance reports.

## Build and run

Build the signed-distribution browser base with `Dockerfile.browser-base`, then
`Dockerfile`. Review and pin each resulting image ID in deployment configuration.
The original app uses local font assets, so its production build is offline.
Set `LH_VISUAL_ISOLATED=1` for the original app build and Unix-only custom server;
it uses the full Next installation rather than Next's standalone server output.
Overlay `compose.visual.yaml` on the existing broker deployment. Preserve existing
course/account/state volumes. The only new host port is loopback 3189 for the
trusted pixel viewer; the original HTTP server is never published on the host.

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
provider silently. Browser/PDF worker execution remains disabled in the app;
static SVG visuals and original theory quiz controls are the intended course flow.
