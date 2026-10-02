import { useEffect, useRef, useState, type RefObject } from "react";
import { Link } from "react-router-dom";
import { LuImagePlus, LuLoader, LuSlidersHorizontal, LuSparkles, LuUpload, LuWandSparkles, LuX } from "react-icons/lu";
import { api, type GalleryPicture, type ImagesFeature, type PictureJob } from "../api";
import { FORM_KEY, parseFields, readForm, type FormMemory } from "../images-gallery";
import { local } from "../safe-storage";
import { isEnter } from "../shortcuts";
import { t, tp } from "../i18n";
import { MaskPainter, type MaskHandle } from "./MaskPainter";
import { ghostCls, inputCls, primaryCls } from "./SettingsUi";

/** The most pictures one edit takes, as the portal sets it (MAX_EDIT_PICTURES). */
export const MAX_SOURCES = 8;

/** What an edit takes in: what the editing endpoints are known to read, the same as the portal checks by the bytes. */
const ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

/**
 * Where a picture is made or changed: a description and a button, with the
 * settings of the request under "Options". With pictures to change it is an
 * edit instead — they are chosen in the gallery, or put in from this computer —
 * and the description says what should change, and where, with a mask if the
 * person paints one. Nothing is made here: the portal does it, as a job, and
 * this says that it was started (`onStarted`).
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
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [masking, setMasking] = useState(false);
  const mask = useRef<MaskHandle>(null);
  const file = useRef<HTMLInputElement>(null);

  const editing = sources.length > 0;
  // Changing a picture has its own switch and address: a picture can be changed where none is made, and the form is for that then.
  const generating = features.enabled && features.baseUrl !== "";
  const full = running >= limit;
  const count = Math.min(form.count, Math.max(1, limit - running));

  // Another picture to change is another picture to paint on.
  const first = sources[0]?.id;
  useEffect(() => setMasking(false), [first]);

  const submit = async () => {
    const said = prompt.trim();
    if (!said || busy || full) return;
    setError(null);
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

  const upload = async (picked: File | undefined) => {
    if (!picked) return;
    setError(null);
    setUploading(true);
    try {
      const picture = await api.uploadPicture(picked);
      onUploaded(picture);
      // Where several pictures are taken, it joins the ones chosen; else it is the one.
      onSources(features.editMultiple && editing ? [...sources, picture].slice(0, MAX_SOURCES) : [picture]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      if (file.current) file.current.value = "";
    }
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
      <label className="text-xs text-fg-muted">
        {t("How many")}
        <select value={count} onChange={(e) => change({ count: Number(e.target.value) })} className={`${inputCls} mt-1 text-xs`}>
          {Array.from({ length: limit }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
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
    <section aria-label={editing ? t("Change a picture") : t("Make a picture")} className="rounded-2xl border border-line bg-raised/40 p-3 sm:p-4">
      {editing && (
        <div className="mb-3">
          <p className="text-xs text-fg-muted">
            {features.editMultiple && sources.length > 1
              ? tp(sources.length, "The {n} picture to work from, in the order the description can refer to them", "The {n} pictures to work from, in the order the description can refer to them")
              : t("The picture to change")}
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-2">
            {sources.map((p, i) => (
              <li key={p.id} className="relative">
                <img src={api.galleryFileUrl(p.id)} alt={p.prompt || p.fileName} loading="lazy" className="h-16 w-16 rounded-lg border border-line object-cover" />
                {sources.length > 1 && <span className="absolute bottom-0.5 left-0.5 rounded bg-surface/85 px-1 text-[10px] tabular-nums text-fg">{i + 1}</span>}
                <button
                  type="button"
                  onClick={() => onSources(sources.filter((s) => s.id !== p.id))}
                  aria-label={t("Do not use this picture")}
                  title={t("Do not use this picture")}
                  className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full border border-line bg-surface text-fg-muted hover:text-fg"
                >
                  <LuX aria-hidden className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
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
              <p className="mb-1.5 text-xs text-fg-subtle">{t("Paint over what should change. Without a mask the whole picture may change. The mask goes with the first picture, and is not kept.")}</p>
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
            disabled={!prompt.trim() || busy || full}
            title={full ? t("{n} pictures are being made: wait for one to finish, or stop one", { n: running }) : undefined}
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
            <input ref={file} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} aria-label={t("Upload a picture")} onChange={(e) => void upload(e.target.files?.[0])} />
            <button type="button" onClick={() => file.current?.click()} disabled={uploading} className={ghostCls}>
              {uploading ? <LuLoader aria-hidden className="h-3.5 w-3.5 animate-spin" /> : <LuUpload aria-hidden className="h-3.5 w-3.5" />}
              {editing && features.editMultiple ? t("Add a picture from this computer") : t("Change a picture from this computer")}
            </button>
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
      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
