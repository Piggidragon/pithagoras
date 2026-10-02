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
 *
 * The same field is on the `tool_execution_start` event of the portal's own
 * call (see the SDK client), so that a call that is still going, failed, or was
 * cut off is told from an extension's too: those have no answer with a path.
 */
export const GENERATED_PICTURE_MARK = "portalImage";
