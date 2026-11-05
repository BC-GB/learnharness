# Courses

Use **Course** above the session list to choose a subject. **Add course** starts an empty course; **Add / view materials** uploads its PDFs, text, CSV, R files or images. Uploads do not start extraction or model calls. Existing duplicate filenames receive a new name rather than replacing a saved material.

The existing course keeps its original records and managed read-only source library. New courses have separate materials, conversations, answers, graph, source inventory, background jobs, extraction, compaction and prompt overrides. Only sanitized model, appearance and general preferences seed a new course. Account connection remains shared; credentials stay behind the existing broker in the restricted deployment.

Each tab carries its own course selection. Switching courses reloads that tab's interface. Another open tab keeps its course and active server work keeps its original binding. Legacy bookmarks continue to open the existing course.

## Enforcement

- API routes validate the course before accessing records. Server pages are dynamic and resolve the same validated course. Invalid or unavailable selections fail closed; URLs without a course selection retain existing-course compatibility.
- Storage accessors, live process registries, graph retrieval and model-facing tools use a server-side asynchronous course context. File reads require the active source root. State reads reject aliases into another profile.
- The browser sends the course with API, stream, export and navigation URLs. It is not a shared selection cookie. Opening-message drafts are also scoped by course.
- The update status endpoint reports counts across all courses, without titles or lesson content, and does not start recovery or inference.
- This is application retrieval isolation. It does not turn one server process into an OS sandbox per course. Docker and the separate credential broker retain the host/network/account boundary.

Course navigation is independent of experimental teaching/progress panels. The previously uninstalled progress experiment remains excluded from the installed lesson layout; the original plan and knowledge graph are unchanged.
