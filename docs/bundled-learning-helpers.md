# Bundled learning helpers

Learning Paths, Lesson outline, Learning preferences and Response notifications are ordinary optional Core plugins. Their source is under `plugins/`; the host packages them into read-only `core-plugins/`. Community executable packages remain disabled in this deployment.

The four reviewed packages default to enabled where no explicit plugin choice exists. Explicit saved disables always win. Enabling a package does not enable the outline observer or notification permission: their existing opt-ins remain authoritative. Learning Paths starts model work only from explicit Architect/child-session actions. Original native teaching prompts have no global Learning Paths instruction contribution; only an explicitly linked child chat receives its tools.

Learning Paths model/artifact preferences are global; paths, sources, conversations and recovery metadata remain course-private. Existing global outline settings and browser notification choices retain their original stores and values. Outline and preferences records are read from their legacy course location only when the plugin has no newer record. New writes go into that course's plugin data directory. Legacy bytes remain untouched for rollback; no startup or GET migration writes occur. Applied prompt additions and recovery journals remain host-owned and revision checked.

The public SDK offers optional host-placed app/session/General widgets, native popup ordering, selected-course metadata, a bounded read-only course library and one-record native session projections. A newly created native chat handle can stage only that chat's opening draft in its captured course; it cannot dispatch inference. Optional configuration/prompt-editing capabilities are granted by explicit host policy, not by plugin manifests. Configuration permits only the reviewed package's keys, with the existing model validation and thinking-level clamping. Credentials, model transport, global preference authority and course isolation remain host responsibilities.

The runtime is trusted bundled Node/browser code, not a plugin sandbox. No new host mounts, outbound routes, credential access, dependency installations or automatic third-party updates are introduced. The original Learning Paths source and license are retained in its package with exact provenance.

## Feature placement audit against upstream 0.6.1

| Local feature | Placement | Reason |
| --- | --- | --- |
| Independent AI lesson outline | Bundled optional plugin | Own context, model work, derived records and floating view; native plan/transcript stay host-owned. |
| Learning-preference conversation | Bundled optional plugin | Own AI conversation and drafting interface; revision-checked prompt Apply/Undo stay host-owned. |
| Response notifications | Bundled optional plugin | Optional browser behavior and device choice, observing the native saved-response event. |
| Learning Paths | Bundled optional plugin | Explicit curriculum workflow and linked native chats; no global teaching instructions. |
| Courses and automatic library binding | Core | Namespace/storage authority for every native and plugin operation. Normal original chat behavior runs inside the selected namespace. |
| Global Settings and prompt customization | Core | Shared preference authority, model validation, explicit apply/recovery and preservation across optional modules. |
| PDF/image composer attachments | Core | Native input lifecycle, immutable bounded storage, explicit Send and existing reader/renderer integration. |
| Reading width, wrapping, fullscreen, response anchoring and confidence wheel | Core | Corrections and controls in the original reading/composer experience. |
| Broker-only authentication, contained renderer and local gateways | Deployment/core enforcement | Security boundaries cannot depend on an optional plugin being enabled. |
| Flashcards, coding questions, drawing pad and rich code blocks | Existing upstream plugins | Retain their existing package/enable controls and deployment restrictions. |

This is an implementation placement decision, not a claim that every application capability should be a plugin. Optional workflows use public host capabilities; storage authority and security enforcement remain in the host.
