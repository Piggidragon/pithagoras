# Images

**Images** appears in the sidebar while [image generation](/guide/features#image-generation)
is switched on and has an address, or while [editing](/guide/features#editing-a-picture)
is. It is the page for making pictures with that endpoint **without a chat**, and for
looking through every picture made with it — here, and by the agent in its chats. Nothing on it needs a model or a conversation:
the page asks the portal, the portal asks the image endpoint you set up.

Where there is no endpoint the page says so, with a link to
**Settings → Add-ons → Images**, and still shows what is in the gallery. Making and
changing a picture are set up apart: with only editing on there is no form to describe
a new picture, which the page says, but a picture can be put in from your computer or
chosen in the gallery to be changed; with only generation on there is no **Edit it** and
no upload.

## Making a picture

Describe it in the box and choose **Make the picture** (`Ctrl`/`Cmd` + `Enter` does
the same; `Enter` alone is a new line). The picture takes its place at the top of the
gallery while it is made — the same frame a chat shows, with how long it has taken
— and the picture arrives where the wait was. Closing the page, or going to another
page of the portal, does not lose it: the portal makes it, and the page shows it
again when you come back.

**Options** has what the request is made with, and the page keeps it for the next
visit (the description is not kept):

| Field | Meaning |
| --- | --- |
| **Model** | Sent as `model` instead of the model saved for the add-on. Empty uses that one. |
| **Picture size** | Sent as `size`, such as `1024x1024`. Empty uses the size saved for the add-on, or none. |
| **How many** | One to four. Each is a request of its own for one picture, so an endpoint that makes one at a time is not asked for a number it may refuse. |
| **Other fields of the request** | One `name=value` to a line, sent with the request as they are, for what an endpoint takes beyond these (`quality=high`, a `seed`). `true`, `false` and plain numbers are sent as such; a value in double quotes is text whatever it looks like (`seed="42"`). The four fields the form sets itself, `model`, `prompt`, `n` and `size`, cannot be set here, and at most twelve can be. |

At most **four** pictures are being made at once — a guard against a click that costs
more than meant, not a measure of what an endpoint can do. **Stop** on a picture that
is being made drops its request, which a hosted endpoint may still charge for, and no
picture comes of it. A picture that is not made says why in its frame, in the endpoint's
words, and **Dismiss** takes it off the page. A restart of the portal ends the pictures
that were being made; nothing is made of them.

Each picture can cost money at a hosted endpoint, as it does for the agent.

## Changing a picture

Choose **Edit it** on a picture in the viewer, or **Change a picture from this
computer** to put one in from your own files; the form then says **Change a picture**
and shows the picture or pictures it works from. Describe what should change and
choose **Change the picture**. It needs [editing](/guide/features#editing-a-picture)
switched on; where it is not, there is no **Edit it** and no upload, and with it on and
generation off, **Run again** is there for a change only, since making a picture from a
description needs generation. An edit goes to
the editing endpoint with the model set for it, and the options above do not apply.

- **The result is a new picture.** The original is never changed, and the new one
  is a gallery picture of its own that the viewer links back to the original.
- **Several pictures.** Where the editing endpoint is [said to take several](/guide/features#several-pictures),
  **Use as a reference** in the viewer adds a picture to the edit (it is a toggle:
  pressed, it takes it out again), up to eight. They are named in the description by
  their order, which is the one shown on the small pictures. This also makes a new
  picture from references; the endpoint cannot tell the two apart, the description does.
- **A mask.** **Only change a part: paint a mask** shows the first picture with a
  brush: paint over what should change. The mask is made at the picture's own size,
  transparent where you painted and opaque elsewhere — the area OpenAI-style endpoints
  change — and goes with the first picture. Without a stroke, no mask is sent and the
  whole picture may change. A mask is made with a pointer or a finger, and is not kept.
- **From this computer.** The picture is checked by its bytes as a PNG, JPEG, GIF or
  WebP, at most 25 MB, and put in the gallery, listed under the name it had, so that it can
  be looked at, changed again and deleted like the others. A file that is no picture is refused.

Pictures are sent as the agent's tool sends them: under a neutral name, as they are,
and never scaled or cut — a picture over the limit is refused, not shrunk.

## The gallery

The gallery is the main part of the page: every picture of **this page**, every one
the agent made in a **chat** with `generate_image` or `edit_image`, and every one that
lies in the folders those tools write into, newest first, in a grid that is two columns
on a phone. Under each picture, its description (the file's name for one that was found
in a folder), where it is from (the chat's title for one the agent made, the folder for
one that was found, how it was made for the others) and how long ago.

- **Paging.** 48 at a time. The next page is loaded as you near the end of what is
  there, and **Show more** does the same. A picture far down is not fetched until
  it is near the screen, so a gallery of hundreds stays quick.
- **Filters.** *Where from*: all, made here, from chats, from folders. *How it was made*:
  all, made, changed, from this computer, not known. They are in the address
  (`/images?origin=chat&kind=edited`), so a link keeps them and **Back** goes through them.
- **Looking at one.** A click opens it in the [viewer](/guide/sessions#looking-at-a-picture),
  which steps through the gallery with the arrows, `←` and `→`, or a swipe, and loads
  the next page when it gets near the end. A picture that was changed has
  **Original** and **Edited version** at the top to go from one to the other, also when
  the original is further down than the gallery has been loaded.
- **A picture that is being made** is a tile of its own, in the place it will have, with
  the same wait a chat shows; a change shows the original under it. When it is made, it
  stays in the place the gallery has for it, in order of time, and the arrows of the
  viewer step through the grid in the order it shows.

### What the viewer adds

Beside its own buttons, the viewer has these for a gallery picture:

| Button | Does |
| --- | --- |
| **Details** | The full description, when and how it was made, the model, the size, the other fields it was asked with, how many pictures an edit was made from and whether it had a mask, the file's name and size, and for the agent's pictures the chat, with a link that opens it. For one that was found in a folder it says which folder, and that nothing is kept of what it was asked for. |
| **Edit it** | Puts the picture in the form to be changed. |
| **Use as a reference** | Adds it to the pictures an edit works from. Only where the editing endpoint takes several. |
| **Run again** | A picture made from a description is made once more, with the model, size and other fields it was made with: one click, one more picture. A change is shown in the form instead, with its pictures and its description, since its mask is not kept; that is what to check before it is made again. Not for a picture you put in yourself, or one that was found in a folder, which have no description. |
| **Delete** | See below. |
| **Open in a new tab**, **Download** | The file itself. |

### Selecting several

**Select** puts a box on every picture: a click selects instead of opening, and
**Select all shown** takes what is on screen. **Download** saves each selected picture
as a file of its own — the browser may ask once whether this page may download several —
and **Delete** takes them away after asking. What is selected belongs to what is shown: a
change of filter, or **Back** to another one, clears it, so that nothing that is not on
screen is deleted with what is. `Esc` or **Done** ends selecting.

### Deleting

A picture is deleted with its file. For a picture the page made that is the portal's own
folder, and the question can be switched off in Settings like the others that delete.

The agent's pictures are files in the **folder a chat works in**
(`generated-images`), and they are not the page's to take lightly: deleting one removes
it from there for good, so the chats that work there and their Files panel lose it. That
is asked **every time, whatever Settings says**, with the chat or the folder named, and a
delete of several says how many of them are in a folder. A picture that was found in a
folder is deleted the same way.

### What the gallery lists

The page lists and serves pictures only from the places the portal knows: its own
folder, `images`, under the portal's data folder, and the `generated-images` folder of
the folders the agent works in — Home, the projects, and the folder of every chat. It
never opens a path the page names — a picture is asked for by its id — and every file is
opened with the checks the Files panel's pictures have: a path inside the folder, no
link followed out of it, and what its bytes say it is.

- The agent's pictures are listed from the moment its tools save them, with what they
  were asked for. **Pictures that nobody listed are found as well:** the ones made before
  the gallery existed. The portal looks in
  `generated-images` of Home, of every project and of every folder a chat works in, and
  lists each file there whose first bytes say it is a PNG, JPEG, GIF or WebP, of at most
  25 MB, whatever it is called. A link is never followed, a file that is no picture is
  left out, and nothing else in those folders — a project's other files, folders inside
  `generated-images`, a hidden file — is looked at. It never looks in a folder the portal
  does not know, so a path somewhere else on the machine is never listed.
- A picture that was found is *from the folder*: which chat made it cannot be told, since
  the chats of a project share its folder and the one that made it may be gone, and what
  it was asked for was not kept. Its *how it was made* is read from its name — `image-…`
  for one made from a description, `…-edited` for a change — and is *not known* for any
  other. It is one entry with a picture the agent recorded, never two: the same file is
  the same picture. It has no description, so a tile carries its file name instead, and
  there is no **Run again** for it; **Edit it** works as for any picture.
- A name the agent used before, whose file was taken away, is a new picture when it makes
  one under it again: the gallery shows the new one with its own description and time.
  Chats that work in one folder, such as the chats of a project, share its files, so this
  holds across them, and a picture one of them made is the original of an edit another makes.
- **The page's own pictures are kept until you delete them.** Nothing is removed by age
  or by how many there are, and the pictures you put in from your computer, up to 25 MB
  each, are kept the same way. **kept from this page**, in the header, shows what they take
  of the disk; the agent's pictures are in their chats' folders and are not counted.
- A picture whose file is gone — taken in the Files panel, or by hand — is dropped from
  the list the next time it is loaded, and so is one that cannot be served any more, such
  as one whose `generated-images` has been replaced by a link out of the folder (what is
  moved to another disk and linked back). When a chat is **deleted**, its pictures stay in
  the gallery, as pictures of its folder with what they were asked for: the files are in
  a folder that is not the chat's to take away, and the portal goes on looking in it. A
  chat that is deleted while its folder cannot be reached has no folder to leave them in,
  and they go from the list. A chat's folder that cannot be reached for the moment, such
  as a drive that is not mounted, is not a file that is gone: its pictures stay in the
  list, are shown again when it is back, and a delete of one says it could not reach the
  file. A picture that was found has no chat to keep it, so it is dropped with its
  folder and found again when the folder is back, and a delete of one says the same while
  the folder cannot be reached.
- Looking through the folders for the first time reads the first bytes of every file
  there; after that the portal only reads the folders' names, and opens a file again only
  when it is new or has changed, so a gallery of hundreds stays quick.
- The list is refreshed when you return to the tab, every half minute while it is on
  screen, and with **Refresh**, so what the agent makes while you are here shows up.

## What it takes from the endpoint

The same as the agent's tools, because it is the same code: the address, model, size and
key are read when a picture is made; the key goes to that address and nowhere else and
**never reaches the page**; a picture sent as an address is fetched only from the
endpoint's own host or over https from the public internet; what comes back must be a
PNG, JPEG, GIF or WebP by its first bytes and at most 20 MB, in three minutes. See
[Opt-in features](/guide/features#what-is-accepted).

| | |
| --- | --- |
| Stored as | The files of the page's pictures in `images` under the portal's data folder, and the list in the portal's own database (`images`). Jobs are kept in memory. |
| API | [`/api/images`](/reference/api#images) |
