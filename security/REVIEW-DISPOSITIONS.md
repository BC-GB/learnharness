# Review of PR8 security paths

## Visual gateway paths and export header

Request paths now select from a startup inventory of installed assets inside the
two explicit asset roots. They are never joined to a filesystem path for serving.
Inventory traversal rejects symlinks outside those roots and directory cycles.
Export routes are validated before backend dispatch and use a fixed attachment
filename. Synthetic regressions cover normal nested assets, outside symlinks,
encoded traversal, header injection and normal export content. These are code
fixes, not scanner suppressions.

## Generated-demo probing (render-worker/job.mjs)

Running generated browser JavaScript is the purpose of the isolated demo worker.
The supplied HTML already contains scripts, so replacing only the probe expression
with a fixed action list would not remove the underlying execution capability.
The probe runs in the browser page, not Node's host context. The worker is non-root,
read-only, networkless, with no account/course/host mounts, dropped capabilities,
Chromium's sandbox, bounded inputs/output, process/memory/CPU ceilings and a job
deadline. Existing worker tests exercise delayed LAN access, deadline termination
and recovery. Preserve this contained functionality rather than claim an allowlist
of probe expressions would make generated scripts trustworthy. Browser/kernel
escapes remain a residual risk; deployment outside these restrictions is unsupported.

## Direct subscription requests (broker/server.mjs)

Direct mode is an explicit deployment option and cannot be selected by request
content. The shared admission path already enforces a 1 MiB body ceiling, strict
headers, streaming and store:false, function-only tools, fixed provider destination,
subscription model normalization, queue/concurrency limits and bounded responses.
Sign-in, permission, spending lock, account identity and authorization epoch are
rechecked after asynchronous credential retrieval; restart never replays requests.
Direct mode is refused for paid API-key live mode. Existing synthetic direct-mode
tests cover permission changes during authorization, forbidden remote tools and
restart replay. These deterministic controls apply before direct dispatch as well
as reviewed requests. Removing all function tools would break teaching and question
panels; mandatory per-request approval is a separate opt-in policy.

This does not establish semantic consent for every byte: the app can send its own
visible lesson/history and selected course content to the configured provider.
It does not receive broker tokens or arbitrary host-file access. Retain this stated
boundary instead of claiming a size limit detects spyware or prompt injection.

## PDF-derived model context (pdf-reader.ts)

The PDF specialist now explicitly treats PDF text, metadata, search results and
images as reference data, and source-framing wraps both tool text and rendered-page
messages. This is defence in depth, not a prompt-injection proof. The loop exposes
only fixed reading operations, pins the selected file outside model arguments and
uses the isolated parser for actual document processing. The source notice cannot
grant additional file/network/credential permissions.

## Upstream v0.6 plugin and side-conversation integration

Plugin backends are native trusted Node code, not a sandbox. The hardened
composition admits reviewed bundled core packages only; community code cannot
activate or serve executable assets. Coding Questions remains unavailable
because its current runner executes model-selected commands with the app's
filesystem authority. A timeout and process cleanup do not make that runner an
acceptable isolation boundary. Enabling it requires an independently isolated
execution service and validation, not a change to this refusal.

Each plugin host, side conversation, worker history, and notification stream
retains its selected course. Delayed work preserves the originating asynchronous
context, including the unbound legacy startup context. Only explicit plugin
enable/settings records and data-only themes are global. Shared preference
paths reject aliases; course history and learning material never move to shared
storage. Pending side preparation, plugin inference, document conversion and
workers are included in the maintenance activity check.

All HTTP launch modes retain the gateway capability requirement. New document
conversion retains the 20 MiB/200-page ceilings and fixed isolated renderer
transport; no in-app Chromium, native PDF fallback, caller-supplied download URL
or unrestricted subprocess path is restored. New inference uses the existing
host model transport and credential broker, without API-key fallback.
The exact document conversion endpoint bypasses Next Proxy's truncating request
clone so its own streaming byte limit can reject oversized bodies. Its handler
checks the same gateway capability on every HTTP method before reading route
parameters or body bytes. All other pages and endpoints remain Proxy-gated.

Upstream Rich Code's TeX engine requires a browser Worker and WebAssembly. The
hardened gateway forbids browser Workers, so the host explicitly reports this
capability unavailable, suppresses TeX instructions and rejects attempts to
enable it. Existing saved preferences are not rewritten. The gateway CSP is not
relaxed to make a plugin run. Chemical structures are also unavailable in the
hardened composition: adversarial SMILES inputs can monopolize the main thread
even with a small source limit. ABC notation is limited to 1 KiB and tested with
malformed, nested and expanded-count inputs. Those input limits and probes are
not a hard CPU or memory isolation guarantee.
Side-conversation newline-delimited JSON uses plain-text streaming through the
existing gateway content-type policy; no new gateway MIME or network allowance
is introduced.
Drawing-pad capture forwards cancellation into the pinned raster/SVG library's
resource fetches, not just the outer promise. The reviewed capture path supplies
font CSS directly and does not enable the library's remote stylesheet fallback.

Plugin dependency setup uses locked npm installs with lifecycle scripts disabled.
Only separately reviewed, explicit SDK/build commands run during packaging.
UI Showcase's authoring-only Puppeteer closure is aligned with the current root
toolchain to remove the vulnerable Zod 3 dependency. Existing build-only
minimatch 9/10 advisories need reachability review; a major override is not a
substitute for compatibility testing or a compatible patched release.
