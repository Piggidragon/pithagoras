import { closeSync } from "node:fs";
import path from "node:path";
import { Type } from "typebox";
import { FileError, baseDir, openPicture } from "../workspace-files.js";

/**
 * Putting a picture in front of the person: a chart the agent drew, a
 * screenshot it saved, a photo it found.
 *
 * The agent has always been able to make pictures — it has a shell — but not
 * to show one: in voice mode there is nothing on the screen but the orb, and in
 * the chat a file name is all that appears. This names a picture in the chat's
 * folder; the page sees the call, and shows it (the picture window in voice
 * mode, a thumbnail under the tool line in the chat).
 *
 * Only the chat's folder, for the same reason the Files panel keeps to it: the
 * page fetches the picture back through /sessions/:id/picture, which serves
 * nothing outside it. A picture anywhere else is copied in first.
 */

/** Where `p` is below `root`, relative to it; null when it is not below it. */
function below(root: string, p: string): string | null {
  const rel = path.relative(root, p);
  return rel && rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel) ? rel : null;
}

/** Where `given` is inside `folder`, relative to it, or an explanation why it is not. */
export function pictureIn(folder: string, given: string): string {
  const base = baseDir(folder);
  // The folder as the agent names it may reach the real one through a link:
  // an absolute path is taken inside either. openPicture then checks what the
  // path really leads to.
  const rel = below(base, path.resolve(base, given)) ?? below(path.resolve(folder), path.resolve(folder, given));
  if (!rel) {
    throw new FileError("invalid", "Only a picture in the chat's folder can be shown. Copy it there first.");
  }
  // Checked as the page will fetch it, so a call that succeeds is one that shows.
  closeSync(openPicture(base, rel).fd);
  return rel;
}

/** An ExtensionFactory — see pi's InlineExtension. */
export function showImageTool(folder: string) {
  return (pi: any) => {
    pi.registerTool({
      name: "show_image",
      label: "show image",
      description:
        "Show the user a picture on their screen: a chart or diagram you made, a screenshot, a photo. " +
        "The file must be a PNG, JPEG, GIF or WebP in the chat's folder (a path relative to it, or absolute inside it); " +
        "save or copy a picture there first. In voice mode this is the only way the user sees a picture. " +
        "Give a short title. Say in words what the picture shows; do not describe it in detail unless asked.",
      parameters: Type.Object({
        path: Type.String({ description: "The picture, relative to the chat's folder or absolute inside it." }),
        title: Type.Optional(Type.String({ description: "A few words shown above the picture." })),
      }),
      execute: async (_id: string, p: { path: string; title?: string }) => {
        const rel = pictureIn(folder, p.path);
        const title = typeof p.title === "string" ? p.title.trim().slice(0, 120) : "";
        const details = { path: rel, ...(title ? { title } : {}) };
        return { content: [{ type: "text", text: `Shown to the user: ${rel}` }], details };
      },
    });
  };
}
