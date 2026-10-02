import { useEffect, useRef, useState, type RefObject } from "react";
import { Link } from "react-router-dom";
import { LuChevronLeft, LuChevronRight, LuImagePlus, LuLoader, LuPlus, LuSlidersHorizontal, LuSparkles, LuUpload, LuWandSparkles, LuX } from "react-icons/lu";
import { api, type GalleryPicture, type ImagesFeature, type PictureJob } from "../api";
import { IMAGE_TYPES, sortFiles } from "../attachments";
import { MAX_SOURCES, MAX_SOURCES_BYTES, addSources, moved, refusal, roomFor, sourceName } from "../edit-sources";
import { FORM_KEY, parseFields, readForm, viewerPicture, type FormMemory } from "../images-gallery";
import { bytesLabel } from "../projects";
import { local } from "../safe-storage";
import { isEnter } from "../shortcuts";
import { t, tp } from "../i18n";
import { ImageViewer } from "./ImageViewer";
import { MaskPainter, type MaskHandle } from "./MaskPainter";
import { Select } from "./Select";
import { ghostCls, inputCls, primaryCls } from "./SettingsUi";

/** What an edit takes in: what the editing endpoints are known to read, the same as the portal checks by the bytes. */
const ACCEPT = IMAGE_TYPES.join(",");

/**
 * Where a picture is made or changed: a description and a button, with the
 * settings of the request under "Options". With pictures to change it is an
 * edit instead — they are chosen in the gallery, or put in from this computer,
 * several at once where the editing endpoint takes them: picked, dropped on the
 * form or pasted — and the description says what should change, and where, with
 * a mask if the person paints one. The pictures are shown in the order the
 * request sends them, each with a way to take it out or move it, and the first
 * is the one the mask is painted on. Nothing is made here: the portal does it,
 * as a job, and this says that it was started (`onStarted`).
 *
 * The settings are kept for the next visit, not the words.
 */
export function ImageMaker({
  features,
  running,
  limit,
  prompt,
  onPrompt,
  promptRef,
  sources,
  onSources,
  onStarted,
  onUploaded,
}: {
  features: ImagesFeature;
  /** How many pictures are being made, and how many may be at once. */
  running: number;
  limit: number;
  prompt: string;
  onPrompt: (prompt: string) => void;
  promptRef: RefObject<HTMLTextAreaElement>;
  /** The pictures to change, in the order the prompt refers to them; none is a new picture. */
  sources: GalleryPicture[];
  onSources: (sources: GalleryPicture[]) => void;
  onStarted: (jobs: PictureJob[]) => void;
  /** A picture of this computer is in the gallery now. */
  onUploaded: (picture: GalleryPicture) => void;
}) {
  const [form, setForm] = useState<FormMemory>(() => readForm(local.get(FORM_KEY), limit));
  useEffect(() => local.set(FORM_KEY, JSON.stringify(form)), [form]);
  const change = (patch: Partial<FormMemory>) => setForm((f) => ({ ...f, ...patch }));

  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // What was done, though not all of what was asked: pictures that did not fit, left out and said so.
  const [notice, setNotice] = useState<string | null>(null);
  const [masking, setMasking] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [looking, setLooking] = useState<string | null>(null);
  const mask = useRef<MaskHandle>(null);
  const file = useRef<HTMLInputElement>(null);

  const editing = sources.length > 0;
  const multiple = features.editMultiple;
  // The pictures as the last of the ones put in meanwhile left them: a drop while another is being uploaded adds to that.
  const sourcesNow = useRef(sources);
  sourcesNow.current = sources;
  // Changing a picture has its own switch and address: a picture can be changed where none is made, and the form is for that then.
  const generating = features.enabled && features.baseUrl !== "";
  const full = running >= limit;
  const count = Math.min(form.count, Math.max(1, limit - running));
  const refused = refusal(sources, multiple);
  const why =
    refused === "one"
      ? t("This editing endpoint takes one picture per edit, and {n} are chosen. Take out all but one, or switch on “Several pictures per edit”.", { n: sources.length })
      : refused === "weight"
        ? t("Together the pictures are over {max}, which is more than an edit takes. Take some out.", { max: bytesLabel(MAX_SOURCES_BYTES) })
        : undefined;

  // Another picture to change is another picture to paint on.
  const first = sources[0]?.id;
  useEffect(() => setMasking(false), [first]);

  // A picture moved or taken out under the keyboard: the button that was pressed is somewhere else or gone, and focus would be lost to the top of the page, so it is put back in the row.
  const row = useRef<HTMLOListElement>(null);
  const refocus = useRef<{ moved: { id: string; by: -1 | 1 } } | { gone: number } | null>(null);
  useEffect(() => {
    const todo = refocus.current;
    refocus.current = null;
    if (!todo) return;
    if ("gone" in todo) {
      // The picture that took its place, or the one before it where it was the last; with none left, the description, where the next thing is typed.
      const looks = row.current?.querySelectorAll<HTMLElement>("[data-source-id]");
      (looks?.length ? looks[Math.min(todo.gone, looks.length - 1)] : promptRef.current)?.focus();
      return;
    }
    const button = (by: -1 | 1) => row.current?.querySelector<HTMLButtonElement>(`[data-move="${by}"][data-move-id="${CSS.escape(todo.moved.id)}"]`);
    // At the end of the row the button that was pressed is off: the one that is left moves it back.
    const same = button(todo.moved.by);
    (same && !same.disabled ? same : button(todo.moved.by === 1 ? -1 : 1))?.focus();
  }, [sources]);

  const submit = async () => {
    const said = prompt.trim();
    if (!said || busy || full || refused) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (editing) {
        const painted = masking ? await mask.current?.mask() : null;
        const { jobs } = await api.changePicture({ prompt: said, sources: sources.map((p) => p.id), ...(painted ? { mask: painted } : {}) });
        onStarted(jobs);
      } else {
        const extra = parseFields(form.extra);
        if ("error" in extra) {
          setError(extra.error === "twice" ? t("Extra fields, line {n}: the name is there twice.", { n: extra.line }) : t("Extra fields, line {n}: write it as name=value.", { n: extra.line }));
          return;
        }
        const { jobs } = await api.makePictures({
          prompt: said,
          ...(form.model.trim() ? { model: form.model.trim() } : {}),
          ...(form.size.trim() ? { size: form.size.trim() } : {}),
          ...(Object.keys(extra.fields).length ? { extra: extra.fields } : {}),
          count,
        });
        onStarted(jobs);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** Puts files in the gallery, one after another so that they keep the order they were given in, and adds them to the pictures of the edit. */
  const put = async (files: File[]) => {
    const { images, others } = sortFiles(files);
    const problems = others.map((f) => t("{name} is not a PNG, JPEG, GIF or WebP picture", { name: f.name || t("Pasted picture") }));
    // Only as many as there is room for are put in the gallery: the rest would be pictures nobody asked to keep.
    const taking = images.slice(0, roomFor(sourcesNow.current.length, multiple));
    const left = images.length - taking.length;
    const got: GalleryPicture[] = [];
    for (const picked of taking) {
      try {
        got.push(await api.uploadPicture(picked));
      } catch (e) {
        problems.push((e as Error).message);
      }
    }
    if (got.length) {
      onUploaded(got[0]);
      const { list } = addSources(sourcesNow.current, got, multiple);
      sourcesNow.current = list;
      onSources(list);
    }
    if (left > 0) {
      setNotice(
        multiple
          ? tp(left, "One picture was left out: an edit takes at most {max}.", "{n} pictures were left out: an edit takes at most {max}.", { max: MAX_SOURCES })
          : tp(left, "One more picture was left out: this editing endpoint takes one picture per edit.", "{n} more pictures were left out: this editing endpoint takes one picture per edit."),
      );
    }
    if (problems.length) setError(problems.join(" "));
  };
  const queue = useRef<Promise<void>>(Promise.resolve());
  /** Picked, dropped or pasted: each set of files waits for the one before it, so that two quick pastes do not take the same places. */
  const addFiles = (files: File[]) => {
    if (!files.length || !features.editReady) return;
    setError(null);
    setNotice(null);
    setAdding((n) => n + 1);
    queue.current = queue.current
      .then(() => put(files))
      .catch((e: Error) => setError(e.message))
      .finally(() => setAdding((n) => n - 1));
  };

  const options = (
    <div className="grid gap-2 sm:grid-cols-3">
      <label className="text-xs text-fg-muted">
        {t("Model")}
        <input
          value={form.model}
          onChange={(e) => change({ model: e.target.value })}
          placeholder={features.model || t("The endpoint's own")}
          spellCheck={false}
          autoComplete="off"
          className={`${inputCls} mt-1 font-mono text-xs`}
        />
      </label>
      <label className="text-xs text-fg-muted">
        {t("Picture size")}
        <input value={form.size} onChange={(e) => change({ size: e.target.value })} placeholder={features.size || "1024x1024"} spellCheck={false} autoComplete="off" className={`${inputCls} mt-1 font-mono text-xs`} />
      </label>
      {/* Not a label: the Select is a button of its own, and a label would pass a click on its text to it. */}
      <div className="text-xs text-fg-muted">
        {t("How many")}
        <Select<number>
          aria-label={t("How many")}
          className="mt-1 w-full"
          value={count}
          onChange={(n) => change({ count: n })}
          options={Array.from({ length: limit }, (_, i) => ({ value: i + 1, label: String(i + 1) }))}
        />
      </div>
      <label className="text-xs text-fg-muted sm:col-span-3">
        {t("Other fields of the request")}
        <textarea
          value={form.extra}
          onChange={(e) => change({ extra: e.target.value })}
          rows={2}
          placeholder={"quality=high\nstyle=natural"}
          spellCheck={false}
          autoComplete="off"
          className={`${inputCls} mt-1 resize-y font-mono text-xs`}
        />
        <span className="mt-1 block text-[11px] text-fg-faint">{t("One name=value to a line, sent with the request as they are. Put a value in quotes to send it as text, not as a number or true or false.")}</span>
      </label>
    </div>
  );

  return (
    <section
      aria-label={editing ? t("Change a picture") : t("Make a picture")}
      className="relative rounded-2xl border border-line bg-raised/40 p-3 sm:p-4"
      onDragOver={(e) => {
        if (!features.editReady || e.defaultPrevented || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        // Down whatever was dropped: a drag that looked like files can carry none, and the overlay would stay up until the next one left.
        setDragging(false);
        if (!features.editReady || e.defaultPrevented || !e.dataTransfer.files.length) return;
        e.preventDefault();
        addFiles([...e.dataTransfer.files]);
      }}
      onPaste={(e) => {
        // A screenshot, or "Copy image" in a browser. Where there is text as well — cells copied from a spreadsheet come with a picture of themselves — the text is what was meant.
        const files = [...e.clipboardData.files];
        if (!features.editReady || !files.length || e.clipboardData.getData("text/plain")) return;
        e.preventDefault();
        addFiles(files);
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-2xl border-2 border-dashed border-accent/60 bg-accent/10 px-4 text-center text-xs text-accent">
          {multiple ? t("Drop pictures here to change them, or to use them as references") : t("Drop a picture here to change it")}
        </div>
      )}
      {editing && (
        <div className="mb-3">
          <div className="flex items-baseline gap-2">
            <p id="edit-sources-heading" className="text-xs text-fg-muted">
              {multiple && sources.length > 1
                ? tp(sources.length, "The {n} picture to work from, in the order the description can refer to them", "The {n} pictures to work from, in the order the description can refer to them")
                : t("The picture to change")}
            </p>
            {multiple && <span className="ml-auto shrink-0 text-[11px] tabular-nums text-fg-subtle">{t("{n} of {max} pictures", { n: sources.length, max: MAX_SOURCES })}</span>}
          </div>
          <ol ref={row} aria-labelledby="edit-sources-heading" className="mt-1.5 flex flex-wrap gap-x-3 gap-y-2">
            {sources.map((p, i) => (
              <li key={p.id} className="flex w-16 flex-col items-center gap-1">
                <div className="relative">
                  {/* A button, so that it can be looked at larger and a keyboard reaches it. */}
                  <button type="button" data-source-id={p.id} onClick={() => setLooking(p.id)} aria-label={t("Look at {name}", { name: sourceName(p) })} title={t("Look at {name}", { name: sourceName(p) })} className="block rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                    <img
                      src={api.galleryFileUrl(p.id)}
                      alt={sourceName(p)}
                      loading="lazy"
                      className={`h-16 w-16 rounded-lg border object-cover ${masking && i === 0 ? "border-accent ring-2 ring-accent" : "border-line"}`}
                    />
                  </button>
                  {sources.length > 1 && <span className="pointer-events-none absolute bottom-0.5 left-0.5 rounded bg-surface/85 px-1 text-[10px] tabular-nums text-fg">{i + 1}</span>}
                  {masking && i === 0 && <span className="pointer-events-none absolute left-0.5 top-0.5 rounded bg-accent px-1 text-[10px] text-white">{t("Mask")}</span>}
                  <button
                    type="button"
                    onClick={() => {
                      refocus.current = { gone: i };
                      onSources(sources.filter((s) => s.id !== p.id));
                    }}
                    aria-label={t("Remove {name}", { name: sourceName(p) })}
                    title={t("Remove")}
                    className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full border border-line bg-surface text-fg-muted hover:text-danger sm:-right-1.5 sm:-top-1.5 sm:h-5 sm:w-5"
                  >
                    <LuX aria-hidden className="h-3 w-3" />
                  </button>
                </div>
                {sources.length > 1 && (
                  <div className="flex gap-1">
                    <button
                      type="button"
                      data-move="-1"
                      data-move-id={p.id}
                      onClick={() => {
                        refocus.current = { moved: { id: p.id, by: -1 } };
                        onSources(moved(sources, i, -1));
                      }}
                      disabled={i === 0}
                      aria-label={t("Move {name} earlier", { name: sourceName(p) })}
                      title={t("Earlier")}
                      className="grid h-6 w-7 place-items-center rounded-md bg-fg/5 text-fg-muted hover:bg-fg/10 hover:text-fg disabled:pointer-events-none disabled:opacity-35"
                    >
                      <LuChevronLeft aria-hidden className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      data-move="1"
                      data-move-id={p.id}
                      onClick={() => {
                        refocus.current = { moved: { id: p.id, by: 1 } };
                        onSources(moved(sources, i, 1));
                      }}
                      disabled={i === sources.length - 1}
                      aria-label={t("Move {name} later", { name: sourceName(p) })}
                      title={t("Later")}
                      className="grid h-6 w-7 place-items-center rounded-md bg-fg/5 text-fg-muted hover:bg-fg/10 hover:text-fg disabled:pointer-events-none disabled:opacity-35"
                    >
                      <LuChevronRight aria-hidden className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </li>
            ))}
            {adding > 0 && (
              <li className="grid h-16 w-16 place-items-center rounded-lg border border-dashed border-line text-fg-subtle">
                <LuLoader aria-hidden className="h-4 w-4 animate-spin" />
                <span role="status" className="sr-only">
                  {t("Adding…")}
                </span>
              </li>
            )}
            {multiple && sources.length < MAX_SOURCES && features.editReady && (
              <li>
                <button
                  type="button"
                  onClick={() => file.current?.click()}
                  aria-label={t("Add pictures from this computer")}
                  title={t("Add pictures from this computer")}
                  className="grid h-16 w-16 place-items-center rounded-lg border border-dashed border-line text-fg-muted transition hover:border-accent/60 hover:bg-accent/5 hover:text-accent"
                >
                  <span className="grid place-items-center gap-0.5 text-[11px]">
                    <LuPlus aria-hidden className="h-4 w-4" />
                    {t("Add")}
                  </span>
                </button>
              </li>
            )}
          </ol>
          <p className={`mt-2 text-[11px] ${refused ? "rounded-lg bg-warn/10 px-2 py-1.5 text-warn" : "text-fg-faint"}`} role={refused ? "alert" : undefined}>
            {why ??
              (multiple
                ? t("The description can name them by their place: “the first picture”, “the second picture”. Drop or paste more pictures here, or add them from this computer.")
                : t("This editing endpoint takes one picture per edit, so a picture you add takes the place of this one. To work from several, switch on “Several pictures per edit”."))}
            {!multiple && (
              <>
                {" "}
                <Link to="/settings/images" className="text-accent hover:underline">
                  {t("Set it up in Settings → Agent → Images")}
                </Link>
              </>
            )}
          </p>
        </div>
      )}

      {!editing && !generating && (
        <p className="mb-3 text-sm text-fg-muted">
          {t("Image generation is switched off, or has no address.")}{" "}
          <Link to="/settings/images" className="text-accent hover:underline">
            {t("Set it up in Settings → Agent → Images")}
          </Link>
          <span className="mt-1 block text-xs text-fg-subtle">{t("Pictures can still be changed: choose one in the gallery, or put one in from this computer.")}</span>
        </p>
      )}
      {(editing || generating) && (
        <label className="block">
          <span className="sr-only">{editing ? t("What should change") : t("What the picture should show")}</span>
          <textarea
            ref={promptRef}
            value={prompt}
            onChange={(e) => onPrompt(e.target.value)}
            onKeyDown={(e) => {
              // Ctrl or Cmd with Enter, so that Enter itself is a new line in a long description.
              if (isEnter(e) && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void submit();
              }
            }}
            rows={3}
            placeholder={editing ? t("Describe the change: what to add, remove or make different") : t("Describe the picture")}
            className={`${inputCls} resize-y`}
          />
        </label>
      )}

      {editing && (
        <div className="mt-2">
          <button type="button" onClick={() => setMasking((v) => !v)} aria-expanded={masking} className={ghostCls}>
            <LuWandSparkles aria-hidden className="h-3.5 w-3.5" />
            {masking ? t("Change the whole picture") : t("Only change a part: paint a mask")}
          </button>
          {masking && sources[0] && (
            <div className="mt-2">
              <p className="mb-1.5 text-xs text-fg-subtle">
                {sources.length > 1
                  ? t("Paint over what should change in picture 1, “{name}”. The mask belongs to the first picture only: to paint on another, move it to the first place, which starts the mask over. Without a mask the whole picture may change. The mask is not kept.", { name: sourceName(sources[0]) })
                  : t("Paint over what should change. Without a mask the whole picture may change. The mask goes with the first picture, and is not kept.")}
              </p>
              <MaskPainter ref={mask} src={api.galleryFileUrl(sources[0].id)} />
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {(editing || generating) && (
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!prompt.trim() || busy || full || !!refused}
            title={full ? t("{n} pictures are being made: wait for one to finish, or stop one", { n: running }) : why}
            className={primaryCls}
          >
            {busy ? <LuLoader aria-hidden className="h-4 w-4 animate-spin" /> : editing ? <LuWandSparkles aria-hidden className="h-4 w-4" /> : <LuSparkles aria-hidden className="h-4 w-4" />}
            {editing ? t("Change the picture") : count > 1 ? t("Make {n} pictures", { n: count }) : t("Make the picture")}
          </button>
        )}
        {!editing && generating && (
          <button type="button" onClick={() => change({ open: !form.open })} aria-expanded={form.open} className={ghostCls}>
            <LuSlidersHorizontal aria-hidden className="h-3.5 w-3.5" />
            {t("Options")}
          </button>
        )}
        {features.editReady && (
          <>
            <input
              ref={file}
              type="file"
              accept={ACCEPT}
              multiple={multiple}
              className="sr-only"
              tabIndex={-1}
              aria-label={t("Upload a picture")}
              onChange={(e) => {
                const picked = [...(e.target.files ?? [])];
                e.target.value = "";
                addFiles(picked);
              }}
            />
            {/* With pictures to work from and room for more, the add button is in their row. */}
            {!(editing && multiple) && (
              <button type="button" onClick={() => file.current?.click()} disabled={adding > 0} className={ghostCls}>
                {adding > 0 ? <LuLoader aria-hidden className="h-3.5 w-3.5 animate-spin" /> : <LuUpload aria-hidden className="h-3.5 w-3.5" />}
                {t("Change a picture from this computer")}
              </button>
            )}
          </>
        )}
        {editing && (
          <button type="button" onClick={() => onSources([])} className={ghostCls}>
            <LuImagePlus aria-hidden className="h-3.5 w-3.5" />
            {t("Make a new picture instead")}
          </button>
        )}
        <span className="ml-auto text-xs tabular-nums text-fg-subtle">{running > 0 ? t("{n} of {max} being made", { n: running, max: limit }) : ""}</span>
      </div>

      {!editing && generating && form.open && <div className="mt-3 rounded-xl border border-line bg-canvas/40 p-3">{options}</div>}
      {editing && <p className="mt-2 text-[11px] text-fg-faint">{t("A change goes to the editing endpoint with the model set for it in Settings → Agent → Images.")}</p>}
      {notice && (
        <p role="status" className="mt-3 rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {looking && (
        <ImageViewer
          pictures={sources.map((p) => viewerPicture(p, api.galleryFileUrl))}
          startId={looking}
          onClose={() => setLooking(null)}
          anchor={(id) => document.querySelector<HTMLElement>(`[data-source-id="${CSS.escape(id)}"]`)}
        />
      )}
    </section>
  );
}
