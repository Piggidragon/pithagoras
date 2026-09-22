/** What of a drag event the guard reads and changes. */
export interface DragLike {
  type: string;
  defaultPrevented: boolean;
  dataTransfer: { types: readonly string[]; dropEffect: string } | null;
  preventDefault(): void;
}

export interface DropHost {
  addEventListener(type: "dragover" | "drop", listener: (e: DragLike) => void): void;
  removeEventListener(type: "dragover" | "drop", listener: (e: DragLike) => void): void;
}

/**
 * Files dropped where nothing takes them are not opened in place of the portal.
 *
 * The message box and the file list take files dropped on them. A little
 * outside either, the browser does what it does with a file dropped on any
 * page: a picture or a PDF is opened in the tab, over the portal, and anything
 * else is downloaded. With drop targets on the page, missing one by a few
 * pixels is easy. Such a drop is now refused, and the pointer says so while
 * dragging.
 *
 * Listens on the window, after the drop targets have had the event: what one
 * of them takes has been claimed with preventDefault by then, and is left alone.
 * Returns what removes it.
 */
export function guardStrayDrops(host: DropHost = window as unknown as DropHost): () => void {
  const refuse = (e: DragLike) => {
    if (e.defaultPrevented || !e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    if (e.type === "dragover") e.dataTransfer.dropEffect = "none";
  };
  host.addEventListener("dragover", refuse);
  host.addEventListener("drop", refuse);
  return () => {
    host.removeEventListener("dragover", refuse);
    host.removeEventListener("drop", refuse);
  };
}
