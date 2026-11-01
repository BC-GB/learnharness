# Read-only spyware audit

Run `Run-Audit.ps1 -AuditDirectory <private-directory> -AppImage sha256:...`.
Use `-NativeImage sha256:... -BrokerImage sha256:...` to include the exact
gateway and credential-broker code images in the same audit.
The first run downloads pinned scanner wheels and public npm archives. It does
not install project dependencies, run their lifecycle hooks, change the app,
renew account permissions or send an inference request. There is no scheduler.

The scanner uses VirusTotal YARA-X 1.22.1 with Datadog GuardDog 3.2.0's source
rules, plus two local review rules. This is a custom runner, **not** the complete
GuardDog CLI, metadata detector set, risk engine or a semantic data-flow proof.
Wheel and rule hashes are checked before use. Wheels live only in the private
audit folder; no global Python installation changes are required.

## Stages

1. Inert detection fixtures check credential/environment exfiltration, delayed
   file sending, browser collection, encoded execution and a benign control.
2. All Git-tracked and unignored source files are scanned as data.
3. Exact lockfile npm archives are checked against SHA-512/SHA-256 integrity,
   then their regular members are scanned without extraction. This includes
   development and optional packages. No dist/build/test or extension exclusions.
4. OSV checks all unique public package/version pairs and follows pagination.
   Only those public names/versions are sent; code, courses and credentials are
   not uploaded. A published vulnerability is distinguished from known malware.
5. Optional Docker tests use the exact local app image with no network, account,
   live state, course or host mounts. Privacy canaries exercise actual provider
   serialization and background processing. Separate deliberate timer,
   document-trigger and restart probes test containment, not benignness.
6. Each supplied image is inspected through a never-started disposable
   container, with no live account, course or state mounts. Code directories
   are copied as tar data, never extracted, signature-scanned and compared
   by content hash with the source/archive reference. Links are inventoried,
   not followed. Generated bundles remain explicitly unmatched unless an
   independent build establishes their provenance. The temporary container
   and only its anonymous volumes are removed; production services are untouched.
   Embedded `/app/.git` or `/app/data` paths are separately flagged. The optional
   `Dockerfile.clean-runtime` removes these paths from a replacement runtime
   filesystem; it is never invoked by the audit itself. Old image layers still
   retain their bytes, so this is runtime minimization, not forensic erasure or
   an image suitable for public distribution without a separate clean build.
7. Installed npm regular files are compared with their exact locked package,
   version and archive-relative path, including nested/bundled dependencies.
   A matching hash in some other package is insufficient. npm's generated
   `.package-lock.json` is reported separately. These checks do not establish
   source provenance for generated frontend bundles or verify OS packages.

`files.jsonl` records hashes and coverage. `matches.json` retains every rule
match. `review-queue.json` prioritizes combinations, including sensitive reads
and outbound capability even when the destination is a legitimate provider.
`gaps.json` records timeouts, oversized files, unreadable members, unsupported
integrity and other incomplete work. `report.json` does not turn candidates or
an unavailable runtime stage into a clean bill of health.

Oversized regular archive members receive a separate, sequential signature
scan up to 256 MiB per file; its coverage and remaining gaps stay explicit.
Source files are refreshed after the initial scan. The original first-pass
evidence remains intact beside the supplementary results.
Lockfile entries without their own archive must have a matching name/version
manifest inside a scanned parent archive; otherwise they produce a coverage gap.

## Efficiency and review

Downloaded archives and per-content scan results are cached outside the repo.
Changed content, rules or scanner implementation invalidates the relevant scan
key. Registry integrity is rechecked even on cached archives. Advisory checks
refresh independently. `-Offline` performs no downloads or advisory queries.

Review candidates by tracing collected data, destination, trigger, and caller.
Do not dismiss them just because they are first-party, a popular dependency,
an SDK, a telemetry function or a legitimate hostname. Likewise keyboard
handlers, network clients and timers alone do not establish spying. Preserve
reasoned dispositions against exact file hashes; changed files need new review.
`reviewed-matches.json` in the private audit directory records a path, SHA-256,
rule and reason for each specifically reviewed match. Reports carry these
forward only for identical content and preserve other unresolved matches.
Do not automatically remove packages or deploy fixes based on heuristic scores.

`review_context.py --root <repo> --run <audit-run> --rule <rule-name>` produces
bounded context for review. It rechecks the archive integrity and exact scanned
file hash before showing code. Optional `--package` and `--limit` narrow output.
It neither executes excerpts nor dismisses findings. Treat excerpts as untrusted
code, and trace callers and payloads before deciding what a match means.

## Limits

- Static signatures can miss novel, obfuscated, cross-file or native payloads.
- Native binaries are signature-scanned; they are not decompiled or fully audited.
- Dependency archives are not proof that deployed artifacts match them. The
  existing Docker manifest/integrity verification is a separate required step.
- Image code scans include generated/minified frontend bundles. Pattern coverage
  does not prove correspondence to original source or inspect the whole base OS.
- Byte/scan-time limits are explicit gaps, never silent passes. Bundled lock
  entries without separate archives are identified in the summary.
- Runtime tests cover named paths and triggers, not every possible date/event.
- Do not run the tool from an unreviewed changed checkout: keep a trusted hash
  manifest for the audit scripts outside the app's writable volumes.

Sources: https://github.com/DataDog/guarddog/tree/v3.2.0,
https://virustotal.github.io/yara-x/docs/api/python/,
https://google.github.io/osv.dev/post-v1-querybatch/.
