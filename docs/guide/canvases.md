# Temporary and stored canvases

New canvases are temporary and held in server memory. They remain available across tab refreshes but disappear when the server restarts. Choose **Store canvas** in the panel header to save the current document permanently; subsequent applied human edits and streamed AI writes auto-save to the database. Existing saved canvases remain permanent.

The header also offers **Download canvas**, which exports Markdown (including the current inline edit draft). Applying inline edits to a temporary canvas does not store it permanently. Interrupted AI writes retain their partial content with the same temporary/stored lifetime.


A canvas is a document associated with a conversation. Open **Canvases** to browse,
read, create, edit inline, or delete the session's documents. The same panel
works during chat and voice mode. Documents can contain plain text or Markdown.

Ask the agent to create a canvas and write into it. The text appears live while
its write arguments stream, rather than waiting for the entire tool call.
Decoded text is retained as it arrives, in memory for temporary canvases and in SQLite for stored canvases. If interrupted, the current text remains as a **Partial draft retained**; incomplete JSON escapes are not invented. Stored partial drafts also survive server restarts.

Choose **Edit inline**, make changes in the same panel, and **Apply changes** (temporary) or **Save changes** (stored).
Your save marks the canvas **Edited by you**. The AI must read it before making
its next change. It can continue its own edits without rereading; an unread
canvas also requires an initial read. Revisions prevent stale edits from
silently overwriting newer text. While an AI write is streaming, finish or
interrupt it before editing manually. A conflicting manual draft stays in the
editor so you can copy it before reloading the document.

The agent has five tools: `canvas_create`, `canvas_list`, `canvas_read`,
`canvas_write` (replace or append), and `canvas_delete`. Write arguments specify
the document and revision before the content so live writes have an unambiguous
target. No content is guessed to complete an interrupted call.

At most two work panels are visible alongside the orb. Opening a third minimizes
the least recently opened panel. On desktop, a single work panel sits on the
right with the full orb on the left. Two panels use the compact orb dock below;
the canvas gets more width than the terminal. Minimizing a document does not
remove it or discard an unsaved edit.

Stored canvases live in the `canvases` table of the existing session database and are
removed when their owning session is deleted. Include `portal.db` in backups.
