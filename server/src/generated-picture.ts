/**
 * What tells the portal's own generate_image from a tool of that name that an
 * extension brings: a field in the `details` of the answer, next to `path` and
 * `title`, which only the portal's tool sets.
 *
 * The page draws a picture from such an answer by its path in the chat's
 * folder, a promise only the portal's tool keeps. Another extension's
 * `generate_image` may answer with a path of its own kind, an absolute one, or
 * one relative to somewhere else; taken for a picture here it would show a
 * broken thumbnail, or the wrong file. In a module of its own, with nothing
 * it imports, so that the page can take it from here as it takes `below`.
 */
export const GENERATED_PICTURE_MARK = "portalImage";
