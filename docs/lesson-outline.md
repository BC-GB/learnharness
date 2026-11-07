# Independent lesson outline

The optional **Settings → General → Lesson outline** switch controls an independent navigation observer. The switch is global when global settings are enabled. It is off by default, so existing installations make no additional model requests until explicitly enabled.

The teacher's actual plan supplies the topic labels, stable IDs and dependency order. At the first plan, entry into a topic, plan revision, or approximately 2,048 new teacher-prose tokens, a separate bounded observer may develop up to five main ideas inside the current topic. It uses the configured extraction/background model slot through the existing connection and background-permission checks. These are additional model requests and consume the same provider allowance. They do not replace the teacher's model or alter subscription/billing controls. There is no API fallback or independent credential store.

## Boundary

The observer has its own system instructions and context. It receives only the current topic, prior outline items, selected-course Markdown excerpts and bounded teacher-facing prose. It has one submission schema and no executable tools. Model-provided source quotes and conversation IDs must match supplied inputs. Output is plain metadata, never HTML or a prompt.

Only separate, course-scoped `lesson-outlines/<chatId>.json` files are written. Chats, plan trees, graph, answers, compaction, teacher prompts and teacher history remain unchanged. Results never use the jobs delivery/teacher-wake mechanism. GET only reads; POST can request a missing/below-threshold update explicitly. Repeated identical successful inputs do not dispatch again. Failures preserve prior metadata, are isolated from teaching and do not produce a timer retry loop. Parallel requests serialize per course/session; pending changed work is coalesced. Running/scheduled observers participate in maintenance idle counts.

Material reads are bounded to the canonical selected-course library, exclude symlinks, hidden directories and personal/generated app/note/practice folders, and accept Markdown only. No model-selected filesystem paths or outside-course reads are available. Source excerpts, previous citations and context have explicit size bounds. A supporting quote is an inspectable grounding constraint, not proof that the model's interpretation is correct.

## View and interpretation

The desktop outline lists the existing topics, highlights the native harness's current plan node, and shows a few main ideas inside that topic. No links, question scores, notes, completion percentages or mastery checks are displayed. The original plan diagram remains available. The original position signal is still the latest tagged quiz; no earlier knowledge-graph extraction is treated as current lesson position.

Initial backfill is bounded to the current topic's recent teacher prose, not a claim that every historical turn was reviewed. Later batches keep a fingerprint/cursor separate from the transcript. Rewritten prefixes invalidate the cursor; plan changes reconcile stable node IDs. Prior observer views are retained in a bounded revision history so changed labels do not silently erase their provenance. An outline is provisional navigation, not a certification of complete course coverage or understanding. Detailed subtopics of future nodes are developed on entry.

The first implementation displays the persistent side column at desktop widths of 1,280px and above. Below that, the original app layout and plan controls remain unchanged. Source reading copies must be present; raw PDF conversion is not part of this observer.

## Verification

Use fake-provider tests for scoped reads/output, exact source quotes, invalid model output, duplicate requests, disabling during async work, unchanged native teacher history, record alias denial and read-only navigation. Test the compiled original lesson/quiz/settings interface, actual course/progress clone and restart, provider boundaries and rollback before installation. A real lesson review is separate from unit tests: inspect whether its labels fit the selected source and conversation. Never publish private course text, lesson records or test captures.
