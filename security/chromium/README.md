# Chromium namespace sandbox

Copy `seccomp.json` to `chromium-seccomp.json` beside the deployment's first
Compose file. Pin its hash with the deployment files. Apply it only to the
isolated browser and render-worker services. Both remain non-root, capability
free, read-only and networkless with `no-new-privileges:true`. Private shared
memory is increased for Chromium; host IPC is never shared.

The base is Moby's default seccomp profile, revision
`6fe7deb1b9fb7c0397a4593480d7d22b9ee8caef`, upstream file SHA256
`6416b47770785a41ac59073cdc77d9fe98517df2799dc83ef207e622de3053f6`:
https://github.com/moby/profiles/blob/6fe7deb1b9fb7c0397a4593480d7d22b9ee8caef/seccomp/default.json

Exactly three additional rules permit Chromium to build its inner sandbox:

1. `clone` may create user/PID/network namespaces; mount, cgroup, IPC and UTS
   namespace flags remain denied. The added clone rule excludes s390 variants
   because their syscall argument layout differs. Validated deployment: x86_64.
2. `unshare` permits only `CLONE_NEWUSER` (0x10000000).
3. `chroot` is permitted by seccomp; the kernel still requires capability in the
   caller's user namespace. The outer container process has no such capability.

`setns`, mount, arbitrary unshare, BPF and privileged host operations are not
newly permitted. `clone3` retains the upstream ENOSYS fallback. No SYS_ADMIN,
privileged container, unconfined seccomp or sandbox-disabling fallback is used.
User namespaces expose some additional kernel code; these controls are not a
guarantee against kernel or Docker vulnerabilities.

Validate `chrome://sandbox` in a disposable fixture: namespace, PID/network and
seccomp-BPF layers must be active. Also inspect actual deployed renderer process
status (nested PID namespace and stacked seccomp filters), test denial of
forbidden calls, and verify browser/worker startup fails without this profile.
Production debugging remains disabled. `--no-sandbox` must never be restored as
an automatic fallback.
