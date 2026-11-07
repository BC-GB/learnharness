# Add instructions without replacing the originals

In Settings → Agents → System prompts, open a segment and choose **Add to
original**. Enter only the extra instructions, check **Preview when enabled**,
then save. Saving activates the customisation. The switch still controls
whether your text is used; switching it off restores the current source.

New customisations default to addition mode. Existing replacements retain
their text and replacement behaviour until explicitly changed. **Replace
original** remains available. The preview and runtime share one composition
rule: original segment, blank line, addition. Other segments keep their order.
Source updates therefore remain present automatically; originals are never
copied into an addition or edited by saving it.

After the global-preferences setup migration, settings and prompt additions
are shared by every course. Course materials, sessions, progress and old
course-specific source guidance stay separate. Old subject prompt files are
never copied into global instructions. The existing main preferences seed
the common settings; all original course settings remain saved for recovery.

Additions are plain Markdown in the app's shared prompt directory under
`.additions/`, mirroring the existing replacement paths. The logical segment
key and on/off switch stay unchanged. An addition takes precedence over a
retained legacy replacement. Choosing replacement explicitly publishes that
file before removing the addition; a crash during this transition leaves the
source-preserving addition active. Delete clears the switch first and removes
both custom files. Backups already include these shared state files.

The API accepts `{text, mode: "append" | "replace"}`. Omitting mode retains
legacy replacement semantics. Invalid modes and unknown/invalid segment
paths are rejected before writing. Unreadable or cross-course aliased additions
fall back to source, rather than reactivating an older replacement. The global
editor shows global prompt content, never another course's private guidance.

Existing installations retain their old layout until setup explicitly calls
`initialiseGlobalPreferences` under the maintenance ingress lock. It adds a
known-field preferences record and a short global teaching addition, leaves
every original file unchanged, and publishes activation last. Future new
courses use the common preferences. Course-specific guidance is composed only
inside that course; new global customisations apply on top. Cross-tab change
signals carry a section name and nonce only. No model calls, provider or
credential changes, dependencies or additional network access are introduced.
