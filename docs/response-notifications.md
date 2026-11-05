# Response notifications

Settings → General → Response notifications enables desktop alerts in the
current browser. Permission is requested only from the learner's toggle click.
Alerts say “Your response is ready.” They include no lesson text, session title,
course name or account data. Clicking opens the corresponding course/session.

The server emits `response-ready` with a chat/message identity after durable
turn settlement. New learner-facing prose, explicit output, questions and
practice problems qualify; thinking, background tools, errors, aborted turns
and failed saves do not. Existing course-scoped SSE carries the event. Nothing
is added to prompts, model payloads, shared retrieval or learner records.

The browser suppresses alerts while its document is visible and focused.
Permission, opt-in and attention are checked again after asynchronous storage.
An atomic IndexedDB claim prevents duplicates across tabs, with at most 256
opaque identity entries retained. Storage failures suppress alerts safely.
The preference is browser-local and can be disabled in General settings.

A tab must remain open and connected. This is a desktop-browser notification,
not external push or a background service worker. Browser or OS settings may
suppress banners, and some embedded/mobile browsers do not support the API.
No extra provider calls, dependencies, permissions to files/network, or
credential-broker changes are needed.
