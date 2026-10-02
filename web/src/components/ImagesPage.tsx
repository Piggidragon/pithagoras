import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { LuCheck, LuDownload, LuImage, LuImagePlus, LuInfo, LuListChecks, LuMessageSquare, LuRefreshCw, LuRepeat, LuTrash2, LuWandSparkles, LuX } from "react-icons/lu";
import { api, type GalleryPicture, type ImagesFeature, type PictureJob, type PictureKind, type PictureOrigin } from "../api";
import { appendPage, fieldsOf, fieldsText, mergeTop, readFilter, sameList, tiles, viewerList, viewerPicture, type Filter, type Tile } from "../images-gallery";
import { pollWhileVisible } from "../poll";
import { bytesLabel } from "../projects";
import { isEscape } from "../shortcuts";
import { sinceThen } from "../time";
import { formatDateTime, msg, t, tp } from "../i18n";
import { useNow } from "./ChatActivity";
import { confirmDialog } from "./ConfirmDialog";
import { ImageMaker, MAX_SOURCES } from "./ImageMaker";
import { ImagePreview, type PreviewState } from "./ImagePreview";
import { ImageViewer } from "./ImageViewer";
import { PageHeader, Stat } from "./PageHeader";
import { Empty, btnCls, ghostCls } from "./SettingsUi";
import type { ViewerPicture } from "../image-viewer";

/** How many pictures a page of the gallery has: enough to fill a screen and some, and few enough to be quick. */
const PAGE = 48;
/** How close to the end of what is loaded the viewer has to get before the next page is asked for. */
const AHEAD = 6;

const ORIGINS: { id: PictureOrigin | ""; label: string }[] = [
  { id: "", label: msg("All") },
  { id: "page", label: msg("Made here") },
  { id: "chat", label: msg("From chats") },
];
const KINDS: { id: PictureKind | ""; label: string }[] = [
  { id: "", label: msg("All") },
  { id: "generated", label: msg("Made") },
  { id: "edited", label: msg("Changed") },
  { id: "uploaded", label: msg("From this computer") },
];

const KIND_NAME: Record<PictureKind, string> = {
  generated: msg("Made from a description"),
  edited: msg("Changed from another picture"),
  uploaded: msg("From this computer"),
};

/** What a tile says of how it was made, in as few words as there are room for under it. */
const KIND_SHORT: Record<PictureKind, string> = {
  generated: msg("Made"),
  edited: msg("Changed"),
  uploaded: msg("Uploaded"),
};

/** The viewer's own buttons are this size; the ones this page adds match them. */
const viewerButton =
  "grid h-10 w-10 shrink-0 place-items-center rounded-lg text-fg-muted transition hover:bg-fg/10 hover:text-fg disabled:pointer-events-none disabled:opacity-35 aria-pressed:bg-accent/15 aria-pressed:text-accent sm:h-9 sm:w-9";

interface Listing {
  pictures: GalleryPicture[];
  next: string | null;
  total: number;
  /** What the page's own pictures take of the disk, whatever the filters show. */
  pageBytes: number;
}

/**
 * Pictures made with the image endpoint, here and by the agent in chats: a
 * form to make or change one at the top, and the gallery under it, which is the
 * main part. The portal keeps the list (server/src/image-gallery.ts) and makes
 * the pictures (server/src/image-jobs.ts); this page asks for a page of the
 * list at a time, newest first, and follows the jobs that are running, each of
 * which holds its place in the grid as the picture being made.
 *
 * A picture opens in the viewer, which steps through the gallery, and
 * has this page's actions beside its own. What is filtered is in the address, so
 * that a link and Back keep it.
 */
export function ImagesPage() {
  const [params, setParams] = useSearchParams();
  const filter = useMemo(() => readFilter(params), [params]);
  const filterKey = `${filter.origin ?? ""}/${filter.kind ?? ""}`;
  const latestFilter = useRef(filter);
  latestFilter.current = filter;
  const setFilter = (next: Filter) => setParams({ ...(next.origin ? { origin: next.origin } : {}), ...(next.kind ? { kind: next.kind } : {}) });

  const [features, setFeatures] = useState<ImagesFeature | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.imagesFeature().then((r) => setFeatures(r.images), (e: Error) => setError(e.message));
  }, []);

  // The gallery, as far as it has been loaded. A filter asks again from the top, and an answer to what was asked before it is not wanted.
  const [list, setList] = useState<Listing>({ pictures: [], next: null, total: 0, pageBytes: 0 });
  const listRef = useRef(list);
  listRef.current = list;
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const asked = useRef(0);

  // What was selected is of the list that was shown: another filter, or Back to one, shows other pictures, and what is not on screen is not to be deleted with what is.
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const mine = ++asked.current;
    setLoading(true);
    setPicked(new Set());
    setList((cur) => ({ pictures: [], next: null, total: 0, pageBytes: cur.pageBytes }));
    api.galleryPage({ ...filter, limit: PAGE }).then(
      (page) => {
        if (asked.current !== mine) return;
        setList({ pictures: page.pictures, next: page.next, total: page.total, pageBytes: page.pageBytes });
        setLoading(false);
      },
      (e: Error) => {
        if (asked.current !== mine) return;
        setError(e.message);
        setLoading(false);
      },
    );
  }, [filterKey]);

  /** The top of the list again, joined to what is loaded: a picture was made, or taken away, or the agent made one in a chat. */
  const refreshTop = useCallback(() => {
    const mine = asked.current;
    api.galleryPage({ ...latestFilter.current, limit: PAGE }).then(
      (page) => {
        if (asked.current !== mine) return;
        setList((cur) => {
          const pictures = mergeTop(cur.pictures, page);
          const next = pictures.length > page.pictures.length ? cur.next : page.next;
          // Nothing moved: nothing is drawn again.
          return sameList(pictures, cur.pictures) && next === cur.next && page.total === cur.total && page.pageBytes === cur.pageBytes ? cur : { pictures, total: page.total, next, pageBytes: page.pageBytes };
        });
      },
      () => {},
    );
  }, []);

  const loadMore = useCallback(() => {
    const { next } = listRef.current;
    if (!next || loadingMoreRef.current) return;
    const mine = asked.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    api
      .galleryPage({ ...latestFilter.current, before: next, limit: PAGE })
      .then(
        (page) => {
          if (asked.current !== mine) return;
          setList((cur) => ({ pictures: appendPage(cur.pictures, page.pictures), next: page.next, total: page.total, pageBytes: page.pageBytes }));
        },
        (e: Error) => asked.current === mine && setError(e.message),
      )
      .finally(() => {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      });
  }, []);

  // The agent makes pictures in chats while this is open, and the gallery is seen again whenever the tab is.
  useEffect(() => pollWhileVisible(refreshTop, 30_000), [refreshTop]);

  // More of the gallery as the end of what is loaded comes near; the button under it is the same for a keyboard, and for a browser with no observer.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !list.next || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((seen) => seen.some((s) => s.isIntersecting) && loadMore(), { rootMargin: "600px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [list.next, list.pictures.length, loadMore]);

  // What is being made. Asked after every start, and every second or two while something is, which is all it takes to see a picture arrive.
  const [jobs, setJobs] = useState<PictureJob[]>([]);
  const [limit, setLimit] = useState(4);
  // What was done already when the page was opened: the pictures are in the gallery, and the jobs are not shown again.
  const ignored = useRef<Set<string> | null>(null);
  const running = useRef<Set<string>>(new Set());
  const poll = useCallback(() => {
    api.pictureJobs().then(
      (r) => {
        ignored.current ??= new Set(r.jobs.filter((j) => j.state === "done").map((j) => j.id));
        const shown = r.jobs.filter((j) => !ignored.current!.has(j.id));
        // A picture that was being made and is done now is in the gallery, and the list asks for it.
        if (shown.some((j) => j.state === "done" && running.current.has(j.id))) refreshTop();
        running.current = new Set(shown.filter((j) => j.state === "running").map((j) => j.id));
        setLimit(r.limit);
        // A job that runs says the same each time it is asked about: only a change is drawn.
        setJobs((cur) => (JSON.stringify(cur) === JSON.stringify(shown) ? cur : shown));
      },
      () => {},
    );
  }, [refreshTop]);
  const active = jobs.some((j) => j.state === "running");
  useEffect(() => {
    poll();
    if (!active) return;
    return pollWhileVisible(poll, 1500);
  }, [active, poll]);

  const started = (made: PictureJob[]) => {
    for (const job of made) running.current.add(job.id);
    setJobs((cur) => [...made, ...cur.filter((j) => !made.some((m) => m.id === j.id))]);
  };
  const dismiss = useCallback((id: string) => {
    running.current.delete(id);
    setJobs((cur) => cur.filter((j) => j.id !== id));
    api.stopPictureJob(id).catch(() => {});
  }, []);

  // What the form is working on: the pictures to change, and the words.
  const [prompt, setPrompt] = useState("");
  const [sources, setSources] = useState<GalleryPicture[]>([]);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [focusForm, setFocusForm] = useState(0);
  useEffect(() => {
    if (focusForm) promptRef.current?.focus();
  }, [focusForm]);

  // Deleted here: their jobs are not shown any more either, though the server may still have them.
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const goneRef = useRef(gone);
  goneRef.current = gone;
  const [opened, setOpened] = useState<string | null>(null);
  const [originals, setOriginals] = useState<ReadonlyMap<string, GalleryPicture>>(new Map());

  const shownTiles = useMemo(() => tiles(list.pictures, jobs, filter, gone), [list.pictures, jobs, filterKey, gone]);
  const forViewer = useMemo(() => viewerList(list.pictures, originals), [list.pictures, originals]);
  const byId = useMemo(() => new Map(forViewer.map((p) => [p.id, p])), [forViewer]);
  const viewerPictures: ViewerPicture[] = useMemo(() => forViewer.map((p) => viewerPicture(p, api.galleryFileUrl)), [forViewer]);

  const [selecting, setSelecting] = useState(false);
  const toggle = useCallback((id: string) => {
    setPicked((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);
  const stopSelecting = () => {
    setSelecting(false);
    setPicked(new Set());
  };
  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => {
      // Not while a dialog over the page has the key.
      if (isEscape(e) && !document.querySelector('[aria-modal="true"]')) stopSelecting();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selecting]);

  const open = useCallback((id: string) => setOpened(id), []);

  /** Takes pictures away, after asking: the page's own as the person's, a chat's with the warning that they are the chat's files. */
  const remove = async (wanted: string[]) => {
    // Only what the page knows is deleted, so that what the question says is all of what goes: a picture it cannot tell the origin of is not one to take away.
    const chosen = wanted.map((id) => byId.get(id)).filter((p): p is GalleryPicture => !!p);
    const ids = chosen.map((p) => p.id);
    if (!ids.length) return;
    const inChats = chosen.filter((p) => p.origin === "chat");
    const only = chosen.length === 1 ? chosen[0] : undefined;
    const ok = await confirmDialog({
      title: tp(ids.length, "Delete this picture?", "Delete these {n} pictures?"),
      message: inChats.length
        ? only
          ? t("It is a file in the folder of the chat “{chat}”, where the agent made it. Deleting it removes it from there for good: the chat will not find it any more, and neither will its Files panel. This cannot be undone.", { chat: only.chat?.title || t("a chat that is gone") })
          : tp(
              inChats.length,
              "{n} of them is a file in the folder of a chat, where the agent made it. Deleting removes it from there for good: the chat will not find it any more. This cannot be undone.",
              "{n} of them are files in the folders of chats, where the agent made them. Deleting removes them from there for good: the chats will not find them any more. This cannot be undone.",
            )
        : t("The file is deleted from the portal. This cannot be undone."),
      confirmLabel: t("Delete"),
      danger: true,
      // Asked whatever Settings says where the file is not the page's own: it is a chat's, and the agent may be working with it.
      deletes: inChats.length === 0,
    });
    if (!ok) return;
    try {
      const done = await api.deletePictures(ids);
      const deleted = new Set(done.deleted);
      // What was made of a deleted picture does not name it any more, as the portal says it either; and an original that was fetched to be reached from an edit is not reached.
      const unlink = (p: GalleryPicture) => (p.from && deleted.has(p.from) ? { ...p, from: null } : p);
      const freed = chosen.filter((p) => deleted.has(p.id) && p.origin === "page").reduce((sum, p) => sum + p.bytes, 0);
      setList((cur) => ({ ...cur, pictures: cur.pictures.filter((p) => !deleted.has(p.id)).map(unlink), total: Math.max(0, cur.total - deleted.size), pageBytes: Math.max(0, cur.pageBytes - freed) }));
      setOriginals((cur) => new Map([...cur].filter(([id]) => !deleted.has(id)).map(([id, p]) => [id, unlink(p)])));
      setGone((cur) => new Set([...cur, ...deleted]));
      setPicked((cur) => new Set([...cur].filter((id) => !deleted.has(id))));
      setSources((cur) => cur.filter((p) => !deleted.has(p.id)));
      if (done.failed.length) setError(tp(done.failed.length, "One picture could not be deleted: {why}", "{n} pictures could not be deleted: {why}", { why: done.failed[0].error }));
      else setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /** Downloads, one file each: the browser may ask once whether this page may download several. */
  const download = (ids: string[]) => {
    ids.forEach((id, i) =>
      window.setTimeout(() => {
        const link = document.createElement("a");
        link.href = api.galleryFileUrl(id);
        link.download = byId.get(id)?.fileName ?? "";
        document.body.append(link);
        link.click();
        link.remove();
      }, i * 350),
    );
  };

  const toForm = () => {
    setOpened(null);
    scroller.current?.scrollTo({ top: 0, behavior: "smooth" });
    setFocusForm((n) => n + 1);
  };
  const editIt = (picture: GalleryPicture) => {
    setSources([picture]);
    toForm();
  };
  const reference = (picture: GalleryPicture) =>
    setSources((cur) => (cur.some((p) => p.id === picture.id) ? cur.filter((p) => p.id !== picture.id) : [...cur, picture].slice(0, MAX_SOURCES)));

  /** The same again: a picture made from a description is made once more, as it was asked for; a change is shown in the form first, since the mask it had is not kept. */
  const runAgain = async (picture: GalleryPicture) => {
    setError(null);
    try {
      if (picture.kind === "generated") {
        const { jobs: made } = await api.makePictures({
          prompt: picture.prompt,
          ...(picture.params.size ? { size: picture.params.size } : {}),
          ...(picture.params.model ? { model: picture.params.model } : {}),
          ...(picture.params.extra ? { extra: fieldsOf(picture.params.extra) } : {}),
        });
        started(made);
        setOpened(null);
        scroller.current?.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      const wanted = picture.params.sources?.length ? picture.params.sources : picture.from ? [picture.from] : [];
      const found = wanted.length ? (await api.galleryPictures(wanted)).pictures : [];
      if (!found.length) throw new Error(t("The pictures this was changed from are not in the gallery any more."));
      setPrompt(picture.prompt);
      setSources(wanted.map((id) => found.find((p) => p.id === id)).filter((p): p is GalleryPicture => !!p));
      toForm();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /** The viewer is showing this picture: more of the gallery is asked for when it nears the end of what is loaded, and the original of a change that is further down is fetched, to be reached from it. */
  const shown = useCallback(
    (picture: GalleryPicture) => {
      const loaded = listRef.current;
      const at = loaded.pictures.findIndex((p) => p.id === picture.id);
      if (loaded.next && at >= loaded.pictures.length - AHEAD) loadMore();
      const from = picture.from;
      if (from && !loaded.pictures.some((p) => p.id === from)) {
        api.galleryPictures([from]).then(
          (r) => r.pictures[0] && !goneRef.current.has(from) && setOriginals((cur) => new Map(cur).set(from, r.pictures[0])),
          () => {},
        );
      }
    },
    [loadMore],
  );

  // Making and changing are set up apart: one can be on without the other.
  const makes = !!features && features.enabled && features.baseUrl !== "";
  const changes = !!features && features.editReady;
  const makingNow = jobs.filter((j) => j.state === "running").length;
  const filtered = !!(filter.origin || filter.kind);
  const pictureTiles = shownTiles.filter((x) => x.picture || x.job?.pictureId);
  const everyId = pictureTiles.map((x) => x.picture?.id ?? x.job!.pictureId!);

  return (
    <div ref={scroller} className="h-full overflow-y-auto px-4 py-6">
      <div className="mx-auto w-full max-w-6xl space-y-4">
        <PageHeader
          icon={<LuImage />}
          title={t("Images")}
          description={t("Make and change pictures with the image endpoint you set up, without a chat, and keep what the agent made in chats.")}
          action={
            <button type="button" onClick={() => { refreshTop(); poll(); }} className={btnCls} title={t("Look for new pictures")}>
              <LuRefreshCw aria-hidden className="h-4 w-4" />
              {t("Refresh")}
            </button>
          }
        >
          <div className="mt-3 flex flex-wrap gap-2">
            <Stat value={list.total} label={t("pictures")} />
            {list.pageBytes > 0 && <Stat value={bytesLabel(list.pageBytes)} label={t("kept from this page")} />}
            {makingNow > 0 && <Stat value={makingNow} label={t("being made")} tone="text-accent" />}
          </div>
        </PageHeader>

        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            <span className="min-w-0 flex-1">{error}</span>
            <button type="button" onClick={() => setError(null)} aria-label={t("Dismiss")} title={t("Dismiss")} className="shrink-0 rounded p-0.5 hover:bg-danger/10">
              <LuX aria-hidden className="h-4 w-4" />
            </button>
          </div>
        )}

        {features &&
          (makes || changes ? (
            <ImageMaker
              features={features}
              running={makingNow}
              limit={limit}
              prompt={prompt}
              onPrompt={setPrompt}
              promptRef={promptRef}
              sources={sources}
              onSources={setSources}
              onStarted={started}
              onUploaded={() => refreshTop()}
            />
          ) : (
            <Empty>
              {t("Image generation is switched off, or has no address.")}{" "}
              <Link to="/settings/add-ons" className="text-accent hover:underline">
                {t("Set it up in Settings → Add-ons")}
              </Link>
            </Empty>
          ))}

        <section aria-label={t("Gallery")}>
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <Segments label={t("Where from")} value={filter.origin ?? ""} options={ORIGINS} onChange={(origin) => setFilter({ ...filter, origin: origin || undefined })} />
            <Segments label={t("How it was made")} value={filter.kind ?? ""} options={KINDS} onChange={(kind) => setFilter({ ...filter, kind: kind || undefined })} />
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {selecting ? (
                <>
                  <span className="text-xs tabular-nums text-fg-muted" role="status">
                    {t("{n} selected", { n: picked.size })}
                  </span>
                  <button type="button" onClick={() => setPicked(new Set(everyId))} disabled={!everyId.length} className={ghostCls}>
                    {t("Select all shown")}
                  </button>
                  <button type="button" onClick={() => download([...picked])} disabled={!picked.size} className={btnCls}>
                    <LuDownload aria-hidden className="h-4 w-4" />
                    {t("Download")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove([...picked])}
                    disabled={!picked.size}
                    className={`${btnCls} hover:bg-danger/10 hover:text-danger`}
                  >
                    <LuTrash2 aria-hidden className="h-4 w-4" />
                    {t("Delete")}
                  </button>
                  <button type="button" onClick={stopSelecting} className={ghostCls}>
                    {t("Done")}
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setSelecting(true)} disabled={!everyId.length} className={btnCls}>
                  <LuListChecks aria-hidden className="h-4 w-4" />
                  {t("Select")}
                </button>
              )}
            </div>
          </div>

          {loading ? (
            <div role="status" className="gallery-grid">
              <span className="sr-only">{t("Loading…")}</span>
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="skeleton aspect-square rounded-lg" style={{ opacity: 1 - i * 0.08 }} />
              ))}
            </div>
          ) : shownTiles.length === 0 ? (
            <Empty>{filtered ? t("No pictures match these filters.") : t("No pictures yet. Describe one above to make the first.")}</Empty>
          ) : (
            <ul className="gallery-grid" aria-label={t("Pictures")}>
              {shownTiles.map((tile) => (
                <li key={tile.key}>
                  <GalleryTile tile={tile} selecting={selecting} selected={picked.has(tile.picture?.id ?? tile.job?.pictureId ?? "")} onOpen={open} onToggle={toggle} onDismiss={dismiss} />
                </li>
              ))}
            </ul>
          )}

          {list.next && (
            <div ref={sentinel} className="mt-4 flex justify-center">
              <button type="button" onClick={loadMore} disabled={loadingMore} className={btnCls}>
                {loadingMore ? t("Loading…") : t("Show more")}
              </button>
            </div>
          )}
        </section>
      </div>

      {opened && (
        <ImageViewer
          pictures={viewerPictures}
          startId={opened}
          onClose={() => setOpened(null)}
          anchor={(id) => document.querySelector<HTMLElement>(`[data-picture-id="${CSS.escape(id)}"]`)}
          actions={(vp) => {
            const picture = byId.get(vp.id);
            if (!picture) return null;
            return (
              <ViewerActions
                key={picture.id}
                picture={picture}
                features={features}
                referenced={sources.some((p) => p.id === picture.id)}
                onShown={shown}
                onEdit={editIt}
                onAgain={runAgain}
                onReference={reference}
                onDelete={(p) => void remove([p.id])}
              />
            );
          }}
        />
      )}
    </div>
  );
}

/** A row of choices of which one holds, the way the audit page filters. */
function Segments<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: string }[]; onChange: (id: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-1">
      <span className="mr-1 text-[11px] text-fg-subtle">{label}</span>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-lg px-2.5 py-1 text-xs transition ${value === o.id ? "bg-accent/12 text-accent ring-1 ring-inset ring-accent/25" : "bg-fg/5 text-fg-muted hover:bg-fg/10"}`}
        >
          {t(o.label)}
        </button>
      ))}
    </div>
  );
}

/** What the picture was made with and for, in words. */
function PictureDetails({ picture }: { picture: GalleryPicture }) {
  const { params } = picture;
  const extra = fieldsText(params.extra);
  const rows: [string, string][] = [
    [t("Made"), formatDateTime(picture.createdAt)],
    [t("How"), t(KIND_NAME[picture.kind])],
    [t("Where"), picture.chat ? t("In the chat “{chat}”", { chat: picture.chat.title || t("a chat that is gone") }) : t("Made here")],
    ...(params.model ? [[t("Model"), params.model] as [string, string]] : []),
    ...(params.size ? [[t("Picture size"), params.size] as [string, string]] : []),
    ...(extra ? [[t("Other fields of the request"), extra] as [string, string]] : []),
    ...(params.sources?.length ? [[t("Changed from"), tp(params.sources.length, "{n} picture", "{n} pictures")] as [string, string]] : []),
    ...(params.masked ? [[t("Mask"), t("Only a painted part was changed")] as [string, string]] : []),
    [t("File"), `${picture.fileName} · ${bytesLabel(picture.bytes)}`],
  ];
  return (
    <div className="space-y-3 text-sm">
      {picture.prompt && (
        <div>
          <p className="text-[11px] text-fg-subtle">{picture.kind === "uploaded" ? t("Name") : t("Description")}</p>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-fg">{picture.prompt}</p>
        </div>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
        {rows.map(([name, value]) => (
          <div key={name} className="contents">
            <dt className="text-fg-subtle">{name}</dt>
            <dd className="min-w-0 whitespace-pre-wrap break-words font-mono text-fg-muted">{value}</dd>
          </div>
        ))}
      </dl>
      {picture.chat && (
        <p className="text-xs text-fg-subtle">
          <Link to={`/s/${picture.chat.id}`} className="text-accent hover:underline">
            {t("Open the chat")}
          </Link>
        </p>
      )}
    </div>
  );
}

/**
 * This page's buttons in the viewer, beside its own, for the picture shown. The
 * viewer draws them again for each picture, and this tells the page which it is
 * on: to ask for more of the gallery, and for an original that is not loaded.
 */
function ViewerActions({
  picture,
  features,
  referenced,
  onShown,
  onEdit,
  onAgain,
  onReference,
  onDelete,
}: {
  picture: GalleryPicture;
  features: ImagesFeature | null;
  referenced: boolean;
  onShown: (picture: GalleryPicture) => void;
  onEdit: (picture: GalleryPicture) => void;
  onAgain: (picture: GalleryPicture) => void;
  onReference: (picture: GalleryPicture) => void;
  onDelete: (picture: GalleryPicture) => void;
}) {
  const [details, setDetails] = useState(false);
  useEffect(() => onShown(picture), [picture.id, onShown]);
  const makes = !!features && features.enabled && features.baseUrl !== "";
  const canEdit = !!features && features.editReady;
  // A picture put in by the person has no description to make again.
  const again = picture.kind !== "uploaded" && picture.prompt !== "" && (picture.kind === "generated" ? makes : canEdit);
  return (
    <>
      {/* Under the button on a wide screen; on a phone, above the zoom buttons, over the picture, so that the buttons that close it are not under it. */}
      <div className="sm:relative">
        <button type="button" onClick={() => setDetails((v) => !v)} aria-expanded={details} aria-label={t("Details")} title={t("Details")} className={viewerButton} aria-pressed={details}>
          <LuInfo aria-hidden className="h-[18px] w-[18px]" />
        </button>
        {details && (
          <div
            className="gallery-details absolute z-10 overflow-y-auto rounded-xl border border-line bg-surface p-3 shadow-pop max-sm:inset-x-2 max-sm:bottom-[calc(3.5rem+env(safe-area-inset-bottom))] max-sm:max-h-[45vh] sm:right-0 sm:top-full sm:mt-1 sm:max-h-[60vh] sm:w-[26rem]"
            role="region"
            aria-label={t("Details")}
          >
            <PictureDetails picture={picture} />
          </div>
        )}
      </div>
      {canEdit && (
        <button type="button" onClick={() => onEdit(picture)} aria-label={t("Edit it")} title={t("Edit it")} className={viewerButton}>
          <LuWandSparkles aria-hidden className="h-[18px] w-[18px]" />
        </button>
      )}
      {canEdit && features!.editMultiple && (
        <button
          type="button"
          onClick={() => onReference(picture)}
          aria-pressed={referenced}
          aria-label={referenced ? t("Do not use as a reference") : t("Use as a reference")}
          title={referenced ? t("Do not use as a reference") : t("Use as a reference")}
          className={viewerButton}
        >
          {referenced ? <LuCheck aria-hidden className="h-[18px] w-[18px]" /> : <LuImagePlus aria-hidden className="h-[18px] w-[18px]" />}
        </button>
      )}
      {again && (
        <button type="button" onClick={() => onAgain(picture)} aria-label={t("Run again")} title={t("Run again")} className={viewerButton}>
          <LuRepeat aria-hidden className="h-[18px] w-[18px]" />
        </button>
      )}
      <button type="button" onClick={() => onDelete(picture)} aria-label={t("Delete")} title={t("Delete")} className={`${viewerButton} hover:!bg-danger/10 hover:!text-danger`}>
        <LuTrash2 aria-hidden className="h-[18px] w-[18px]" />
      </button>
    </>
  );
}

/** What a job's state is to the preview. */
const previewState = (job: PictureJob | undefined): PreviewState => (!job ? "done" : job.state === "running" ? "making" : job.state === "failed" ? "failed" : "done");

const GalleryTile = memo(function GalleryTile({
  tile,
  selecting,
  selected,
  onOpen,
  onToggle,
  onDismiss,
}: {
  tile: Tile;
  selecting: boolean;
  selected: boolean;
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const { picture, job } = tile;
  const state = previewState(job);
  const id = picture?.id ?? job?.pictureId;
  const making = state === "making";
  const now = useNow(making);
  const here = state === "done" && id;
  return (
    <div className={`gallery-tile${selected ? " is-selected" : ""}`}>
      <ImagePreview
        state={state}
        edit={job?.kind === "edit" || picture?.kind === "edited"}
        src={here ? api.galleryFileUrl(id) : undefined}
        before={job?.from && making ? api.galleryFileUrl(job.from) : undefined}
        ratio={1}
        title={picture?.prompt || job?.prompt || picture?.fileName}
        reason={job?.error}
        elapsed={making && job ? Math.max(0, Math.floor((now - job.startedAt) / 1000)) : undefined}
        pictureId={here ? id : undefined}
        onOpen={selecting ? onToggle : onOpen}
        actions={
          job && state !== "done" ? (
            <button type="button" className="gallery-tile-action" onClick={() => onDismiss(job.id)}>
              {making ? t("Stop") : t("Dismiss")}
            </button>
          ) : undefined
        }
      />
      {selecting && here && (
        <input type="checkbox" className="gallery-check" checked={selected} onChange={() => onToggle(id)} aria-label={t("Select this picture")} />
      )}
      {picture && (
        <p className="gallery-meta">
          {picture.chat && <LuMessageSquare aria-hidden />}
          <span className="truncate" title={t(KIND_NAME[picture.kind])}>{picture.chat ? picture.chat.title || t("a chat that is gone") : t(KIND_SHORT[picture.kind])}</span>
          <time dateTime={new Date(picture.createdAt).toISOString()} title={formatDateTime(picture.createdAt)}>
            {sinceThen(picture.createdAt, { dateAfterDays: 7, dateFormat: { month: "short", day: "numeric" } })}
          </time>
        </p>
      )}
    </div>
  );
});
