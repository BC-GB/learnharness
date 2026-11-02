# Isolated PDF and demo worker

The app sends document bytes or self-contained HTML to a fixed Unix socket. The worker has no course, account, app-state, host-directory or Docker mounts and no network adapter. It is read-only/non-root with dropped capabilities, memory/PID limits and disposable temporary storage. Each operation runs in a child process, with input/output limits and a hard deadline. Cleanup includes detached Chromium descendants, with tini reaping orphans.

PDF handling is the original local implementation from commit 68deca4, adapted only for worker dependencies. Model file paths are validated against the approved source library before bytes are read. Uploaded files use the existing bounded multipart route and then this worker. PDF text, images and demos remain untrusted data.

`compose.yaml` enables this worker explicitly. Without it the original deny-by-default behavior remains. PDFs are limited to 20MiB/200 pages; render calls to eight selected pages. Demo execution is offline; external scripts and CDN assets are blocked. This does not restore third-party research/search or paid speech services. Chromium uses the Docker boundary rather than its native sandbox; this is not a kernel-escape guarantee.

Validation: `test-worker.mjs` exercises path denial, demo execution, delayed LAN attempts, runaway JavaScript termination and recovery. Run it only in a disposable worker container with the same restrictions. `security/visual/test-browser-transfers.py` requires a synthetic app/renderer/browser fixture on loopback 3192, Playwright and Docker; it checks selected PDF upload, text/image export, refresh, and denied cross-origin/arbitrary routes. Neither test uses a real provider or account.
