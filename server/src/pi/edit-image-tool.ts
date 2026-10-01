import path from "node:path";
import { Type } from "typebox";
import { GENERATED_PICTURE_MARK } from "../generated-picture.js";
import { editImage } from "../image-editing.js";
import {
  EDIT_IMAGE_SOURCE,
  EDIT_IMAGE_TOOL,
  MAX_PROMPT,
  imageEditingReady,
  imageEditingTarget,
  imageGenerationConfig,
} from "../image-generation.js";
import { baseDir, readPicture } from "../workspace-files.js";
import { saveGenerated, takenByAnother } from "./generate-image-tool.js";
import { pictureIn } from "./show-image-tool.js";

/**
 * Changing a picture that is in the chat's folder, with the image endpoint the
 * person set up in Settings → Add-ons → Images, and putting the result in front
 * of them.
 *
 * It answers as generate_image does — the path of the new picture in the chat's
 * folder, a title and the mark that it is this tool's (see generated-picture.ts)
 * — so the page draws it the same way: a thumbnail in the chat, the picture
 * window in voice mode. The original is never touched. The result is a new file
 * in the same folder generated pictures go in, named after the original (see
 * editedName), and nothing is written until the endpoint has answered with a
 * real picture: a failed edit leaves no file and no folder behind.
 */

/** Said to the model in a spoken conversation, where it is the only way the person sees a picture. */
export const EDIT_IMAGE_VOICE_LINE =
  "To change a picture in the chat folder, call edit_image: it saves the result as a new picture and shows it, so do not call show_image on it afterwards.";

/**
 * What a result is called: the original's name with "-edited" before the
 * extension, so that the two sort together. An edit of an edit is not
 * "-edited-edited": the mark is taken off first, and a name that is taken gets
 * the number any new file gets ("photo-edited (2).png").
 */
export function editedName(original: string, ext: string): string {
  const stem = path.basename(original, path.extname(original)).replace(/-edited(?: \(\d+\))?$/, "");
  // Room is left for the rest of the name, and for a number, within the 255 bytes a name may have.
  return `${Array.from(stem || "image").slice(0, 80).join("")}-edited.${ext}`;
}

/**
 * An ExtensionFactory — see pi's InlineExtension.
 *
 * Decided each time pi loads it, and again on a reload, as GenerateImageTool
 * is: while editing is off or has no address there is no tool at all, and the
 * voice rule says nothing of one.
 */
export class EditImageTool {
  private on = false;
  constructor(
    private readonly folder: string,
    private readonly extensions: () => readonly any[] = () => [],
  ) {}

  registered = (): boolean => this.on && !takenByAnother(this.extensions(), EDIT_IMAGE_TOOL, EDIT_IMAGE_SOURCE);

  extension = (pi: any) => {
    this.on = false;
    if (!imageEditingReady()) return;
    const folder = this.folder;
    pi.registerTool({
      name: EDIT_IMAGE_TOOL,
      label: "edit image",
      description:
        "Change a picture in the chat's folder as told, with the image model the person has set up for editing, and show the result to them. " +
        "The picture is a PNG, JPEG, GIF or WebP in the chat's folder (a path relative to it, or absolute inside it). " +
        "It stays as it is: the result is a new picture in the chat's generated-images folder, named after it, and appears on their screen as show_image's does, " +
        "so do not call show_image on it. Say what should change; what is not mentioned should stay as it is. " +
        "It can take a minute and costs the person something, so make one edit, and another only when asked. " +
        "Give a short title. Say in words what you changed; do not describe it in detail unless asked.",
      parameters: Type.Object({
        path: Type.String({ description: "The picture to change, relative to the chat's folder or absolute inside it." }),
        prompt: Type.String({ description: "What should change in it." }),
        title: Type.Optional(Type.String({ description: "A few words shown above the picture." })),
      }),
      execute: async (_id: string, p: { path: string; prompt: string; title?: string }, signal?: AbortSignal) => {
        // Read now, not when the tool was loaded: an address, a model or a key changed since is in force.
        const config = imageGenerationConfig();
        if (!imageEditingReady(config)) {
          throw new Error("Image editing is switched off, or has no address now. Tell the person; there is no other way to change a picture.");
        }
        const prompt = typeof p.prompt === "string" ? p.prompt.trim() : "";
        if (!prompt) throw new Error("A prompt is required: say what should change in the picture.");
        if (prompt.length > MAX_PROMPT) throw new Error(`The prompt is over ${MAX_PROMPT} characters; say it shorter.`);
        // Where it is in the chat's folder, as show_image needs it, and read from there: no other place is read.
        const original = pictureIn(folder, p.path, "edited");
        const { bytes: image } = readPicture(baseDir(folder), original);
        const { bytes, ext } = await editImage(imageEditingTarget(config), { prompt, image }, { signal });
        const rel = saveGenerated(folder, bytes, ext, editedName(original, ext));
        const title = (typeof p.title === "string" && p.title.trim() ? p.title : prompt).replace(/\s+/g, " ").trim().slice(0, 120);
        const details = { path: rel, ...(title ? { title } : {}), [GENERATED_PICTURE_MARK]: true };
        return { content: [{ type: "text", text: `Edited ${original}, and shown to the user: ${rel}` }], details };
      },
    });
    this.on = true;
  };
}
