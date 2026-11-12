# Images in browser chat

Paste an image with Ctrl+V (Cmd+V on macOS), or use the paperclip to choose
an image. A thumbnail appears above the draft. Remove it with × or send
normally. Pasting does not start a turn. Normal text pasting is unchanged.

The practice **Your thinking** field supports the same paste, paperclip and
removable previews. **Submit thinking** waits until an upload finishes;
collapsing the problem keeps the draft and pending attachment intact. An
upload error leaves the draft available to edit or retry.

The browser receives only the clipboard files supplied by that paste event;
there is no background clipboard reader or additional clipboard permission.
HTML image URLs are not fetched. PNG, JPEG, GIF, WebP and BMP are accepted,
up to four per draft, 25 MiB per input, 16 megapixels and 8192px per side.

The server checks actual bytes and geometry, re-encodes in the existing
terminable image worker and stores an upright, metadata-free raster under
the selected course's `pasted-images` state directory. Stored images are
content-addressed, at most 1 MiB each, with a 256 MiB / 2000-file course
quota. Identical images deduplicate within a course. Images remain saved
after removing a draft attachment, so older conversations keep working.
They are separate from the official read-only material library and graph
imports. Existing state backups include them.

The message uses the app's normal quoted path chip. The existing `read`
tool can read that exact validated raster; `show_image` and image visuals
can use it too. This does not grant general access to state, other courses,
the host filesystem, clipboard or network. No prompts, model selection,
provider connection or credential handling change. The selected model must
support image input to interpret it, as with existing image files.

The web gateway's authentication, same-origin checks and clipboard-read
denial remain intact. This is open-page clipboard support, not background
capture. The desktop's existing path-based file/folder picker is retained.
