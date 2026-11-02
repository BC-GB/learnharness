# Direct browser access

This gateway serves the original Next app to a normal browser. The app stays
networkless in Docker and the credential broker remains separate. Only the
gateway is published, on IPv4 loopback. It can reach the app's fixed Unix socket;
it cannot access the broker's control socket or credential volumes.

Overlay `compose.yaml` on the existing app/broker deployment. Pin `NATIVE_IMAGE`
and `VIEW_NET_IMAGE` to locally verified image IDs. The app must serve its
desktop-authenticated web interface at `/app-ipc/web.sock`.

The trusted local launcher reads `/view-secret/token` and opens
`http://127.0.0.1:3192/open#TOKEN`. The bootstrap removes the fragment before
loading app code, exchanges it for a purpose-specific HttpOnly, SameSite=Strict
cookie, and opens the app. An optional `?lesson=ID` selects a saved lesson.
Never publish the token or put it in a query string.

The gateway validates Host, Origin and fetch metadata; strips credentials and
upstream cookies; rejects external redirects and active HTML downloads; and
sets CSP and browser permission restrictions. CSP permits the original app's
inline hydration and sandboxed demos, but not external fetches, images, fonts,
scripts, workers or frames. Mutations require the exact native Origin. The
network namespace firewall blocks gateway-initiated TCP connections.

This is a browser-sandbox boundary, not remote pixel isolation. CSP is defense
in depth, not a complete network firewall for arbitrary malicious frontend
code: navigation and browser vulnerabilities remain outside that guarantee.
Use a maintained browser. Files are available only when explicitly selected;
the backend retains only its mounted course/state volumes. Microphone, camera,
device access and alternative account/API-key setup remain disabled.

`Dockerfile.test` exercises transport and gateway boundary failures offline.
Real-browser integration should also cover a mock lesson, quiz, math, visuals,
saved sessions, exports and browser policy enforcement before switching users.
