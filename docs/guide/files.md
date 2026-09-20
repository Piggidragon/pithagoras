# Files

The folder icon in a chat's header opens **Files**: the folder the chat works
in, beside the conversation, where the browser and the terminal open. It is the
same folder the agent reads and writes, so what it produces can be looked at,
changed or taken away without a shell on the host.

That folder is the project the chat is in, the workspace root, or Home for a chat
that started there. Nothing outside it can be reached.

## What you can do

- **Browse.** Click a folder to go in, the path at the top to go back.
  Folders come first; `.git` is not listed. A link that leads out of the folder
  is shown greyed out and cannot be opened.
- **Read and change.** A text file opens as text. Edit it and choose **Save**
  (or press <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>S</kbd>). A file that is not text, or is over
  1 MB, is not shown; download it instead.
- **Download** one file, or the whole folder as a `.tar.gz` (without
  `node_modules`, `.git`, `dist`, `build` and virtual environments).
- **Delete** a file or a folder and everything in it, after a confirmation. A
  link is removed as the link; what it points at stays.

The agent writes here too, so a save is checked. If the file changed after you
opened it, the save is refused and you choose between loading the new version
and saving yours anyway.

## Watching the agent

Files follows the agent. When it reads a file, or writes or edits one, that file
is shown — the editor, live, as it changes. Opening a file or a folder yourself
takes over from that, and **Follow** hands it back. Editing is never interrupted:
while you have unsaved changes, the agent's next file does not replace them.

In [voice mode](/guide/voice) it opens on its own the first time the agent touches
a file, in the same way as the browser and the terminal, and there is a folder
button in the top right to open it yourself.

## Panels

At most two panels are open beside the conversation. Opening a third closes the
one that has been open longest. The browser, the terminal, Files and
[canvases](/guide/canvases) all count.
