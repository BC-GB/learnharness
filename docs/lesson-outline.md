# Independent AI lesson outline

Settings → General → Lesson outline enables an independent navigation observer. The panel's settings button opens its own model and reasoning controls. Until explicitly changed, these retain the existing extraction/background defaults, including a saved extractor override. Selecting an outline model changes only the global outline preference; teacher and extraction models remain unchanged. Choices use the original connected-model catalog, unsupported reasoning levels clamp on write, and a saved unavailable selection remains visible and repairable. Changes apply to the next outline update and do not trigger a model call by themselves. These additional observer requests consume the existing provider allowance; no API fallback, new credentials or billing controls are introduced.

## Structure and evidence

The AI creates its own short group titles, main-idea labels and explanatory order from the native plan and selected-course readings. Nodes are references, not fixed UI containers: related nodes may be combined, and a broad node may appear in several groups. Every original node ID must remain represented internally. The native plan, graph and teacher are never edited.

The observer receives plan-wide source excerpts, explicit per-node retrieval coverage, a representative historical sample and recent teacher prose. The latest quiz tag is only a hint. The AI places the current idea using actual teacher-message evidence; an unsupported current marker is removed. Course quotes must occur in supplied source text. A valid quote verifies provenance, not semantic correctness or complete course coverage. Missing readings are explicit gaps, not permission to invent details.

During ordinary updates the prior outline remains stable while message evidence accumulates. Structural revisions require an internal reason, with bounded previous views retained. Encountered content is not mastery. Initial historical review is sampled and bounded; it does not certify that every past turn or course requirement was reviewed.

## Independence and safety

Its own prompt, context, cursor and course-scoped version-two sidecar are separate from teacher prompts, native history, answers, graph and compaction. No outline result wakes or steers the teacher. Teacher filesystem tools remain confined to course sources and cannot retrieve the state sidecar. Earlier version-one navigation files stay byte-identical for rollback; the observer generates a fresh AI-designed outline rather than relabelling old native containers.

One optional hook runs after a teacher turn settles. First outline, plan/node changes, or about2,048 new teacher-prose tokens may trigger an update. Work serializes per course/session, shares existing background capacity and has a60second deadline. Permission and source-prefix checks repeat after queuing and before saving. Identical successful input deduplicates. Interrupted work can resume; failures do not start timer retry loops or modify teaching. GET and opening/minimizing/moving the panel only read. Running/scheduled observers count toward installation activity.

The source reader performs one canonical selected-course walk per update: maximum depth7,2,000entries,8MiB Markdown total and512KiB/file. Symlinks, hidden directories and generated/personal folders are excluded. Numbered revised readings replace older editions before ranking. The broad material pack includes at most16sources and explicit retrieval coverage. Context, output, IDs, quotes, prior snapshots and files have bounds. No model-selected filesystem path, executable tool or arbitrary outbound destination is available.

## Floating view

A compact floating card displays AI group headings and the current group's ideas without reserving transcript width. The current idea has an arrow; earlier encountered ideas have a filled dot and upcoming ideas an open circle. There are no percentages, mastery claims, links, notes, quiz results or scores. Its handle supports dragging and keyboard arrows; minimize/expand and movement affect browser UI only. Viewport changes constrain its position; the original composer, question tools and fullscreen remain available. It is usable below desktop widths too.

## Validation

Require exact-head hosted CI/CodeQL, source/import-map review, unit and delayed-state tests, and compiled mock-provider checks. Verify original lesson/quiz/equation/SVG/PDF/settings/export behavior, course isolation, floating geometry, dragging, keyboard movement, minimization, narrow layouts and read-only GET. Restore actual course/progress into disposable volumes, preserve version-one metadata, test version-two generation/restart and rehearse rollback before installation. Live provider semantics need a separately authorized current-lesson test; mocks alone cannot establish good grouping. Never publish private course text, state or audit captures.
