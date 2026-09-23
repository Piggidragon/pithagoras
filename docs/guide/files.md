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
- **Hide or show dotfiles.** Names that start with a dot (`.env`, `.cache`, …) are
  hidden to begin with, and a line under the list says how many. The eye icon at
  the top turns them on and off, and the choice is remembered in the browser.
  What the agent opens is shown either way.
- **Read and change.** A text file opens as text. Edit it and choose **Save**
  (or press <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>S</kbd>). A PNG, JPEG, GIF or WebP picture is
  shown as a picture (up to 25 MB). Any other file that is not text, or is over
  1 MB, is not shown; download it instead.
- **Download** without opening: every row has a download button, for a file or,
  for a folder, as a `.tar.gz`. The button at the top downloads the folder you are
  in (without `node_modules`, `.git`, `dist`, `build` and virtual environments).
- **Make a file or a folder** with the two buttons at the top, in the folder
  you are in. A new file opens straight away, ready to write in. Neither ever
  takes the place of something already there.
- **Upload** with the arrow at the top, or by dropping files on the list: they
  go in the folder you are in. A name that is taken gets a number —
  `notes (2).md` — rather than replacing anything, and a file is only put in
  place once all of it has arrived, so an upload cut short leaves nothing
  behind. Up to 2 GB a file. Files dropped on the message box go to the chat's
  folder as well — see [Pictures and files](/guide/sessions#pictures-and-files).
- **Rename** a file or a folder with the pencil on its row. Enter keeps the new
  name, Escape leaves it. It is a new name in the same folder, and never replaces
  something that is already there.
- **Delete** a file or a folder and everything in it, after a confirmation. A
  link is removed as the link; what it points at stays.

A save is made whole: the text is written beside the file and put in place, so a
save that fails (a full disk, say) leaves the file as it was.

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
one that has been open longest — unless Files has an edit that is not saved, in
which case another one is closed instead. Closing Files yourself, or reloading the
page, asks first while there is an edit. The browser, the terminal, Files and
[canvases](/guide/canvases) all count.
