import { ImageGenerationError, requestPicture, type GenerateOptions, type ImageEditingTarget } from "./image-generation.js";
import { pictureExt, pictureType } from "./prompt-images.js";
import { MAX_PICTURE_BYTES } from "./workspace-files.js";

/**
 * Changing a picture with the image endpoint the person set up: the same add-on
 * as generation (see image-generation.ts), asked for `images/edits` instead.
 *
 * The request is the OpenAI-style one — a multipart form with the picture, a
 * prompt and optionally a mask, and the model when there is one — and the
 * answer is read as a generation's is, as `b64_json` or `url`, with the same
 * rules for where an address may lead, the same check of the bytes and the same
 * limits. Other request shapes are not translated.
 *
 * What the agent's tool and the Images page share is here: the checked request
 * and the picture that comes back. Nothing is written by it; where the result
 * goes is the caller's business, and a request that failed has left nothing
 * anywhere.
 */

/** Where the request goes: the base, with the route the OpenAI-style APIs have unless it is already there. */
export function editEndpointUrl(baseUrl: string): URL {
  const url = new URL(baseUrl);
  // The address of generation is taken as it stands, so its route is swapped for this one.
  const base = url.pathname.replace(/\/+$/, "").replace(/\/images\/(generations|edits)$/, "");
  url.pathname = `${base}/images/edits`;
  return url;
}

export interface EditRequest {
  /** What should change. */
  prompt: string;
  /** The picture to change. Its type is read from its bytes. */
  image: Buffer;
  /** Marks the area to change, where the endpoint takes one. Checked as a picture; its size must match the picture's, which the endpoint tells. */
  mask?: Buffer;
}

export interface EditOptions extends GenerateOptions {
  /** The most the picture and the mask may be each; the same limit the Files panel shows a picture up to by default. */
  maxInputBytes?: number;
}

/** A picture to send: what its first bytes say it is, and not larger than the limit. */
function toSend(bytes: Buffer, what: string, max: number): { blob: Blob; name: string } {
  const type = pictureType(bytes.subarray(0, 12));
  if (!type) throw new ImageGenerationError(`The ${what} is not a PNG, JPEG, GIF or WebP picture`);
  if (bytes.length > max) throw new ImageGenerationError(`The ${what} is over ${Math.round(max / 1024 / 1024)} MB`);
  // Never the file's own name, which says where it came from: a neutral one, with the extension its bytes say.
  return { blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type }), name: `${what}.${pictureExt(bytes.subarray(0, 12))}` };
}

/**
 * Asks for a picture changed and returns the result, checked as a generated
 * one is: a PNG, JPEG, GIF or WebP by its first bytes, and not too large.
 *
 * A picture that is no picture, or is over the limit, is refused before anything
 * is sent, so that nothing leaves the portal that should not. `size` is not
 * sent: what an edit comes out as is the endpoint's to say, usually the
 * picture's own, and the size set for generation need not be one an edit takes.
 */
export async function editImage(
  target: ImageEditingTarget,
  request: EditRequest,
  options: EditOptions = {},
): Promise<{ bytes: Buffer; ext: string }> {
  const max = options.maxInputBytes ?? MAX_PICTURE_BYTES;
  const image = toSend(request.image, "image", max);
  const mask = request.mask ? toSend(request.mask, "mask", max) : undefined;
  const form = new FormData();
  form.append("image", image.blob, image.name);
  if (mask) form.append("mask", mask.blob, mask.name);
  form.append("prompt", request.prompt);
  if (target.model) form.append("model", target.model);
  form.append("n", "1");
  // The time limit is generation's too: the picture goes up first, and then the endpoint makes the new one.
  return requestPicture(editEndpointUrl(target.baseUrl), target.apiKey, form, options);
}
