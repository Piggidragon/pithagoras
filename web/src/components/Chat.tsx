import { CompactionMarker, StatusIndicator, ThinkingBlock, ToolCall } from "./ChatActivity";
import { VoiceTerminal } from "./VoiceTerminal";
import { useWorkPanels } from "../use-work-panels";
import { useFollowBottom } from "../use-follow-bottom";
import { CanvasPanel } from "./CanvasPanel";
import { displaySpeechText } from "../voice";
import { latestBrowserActivity, latestTerminalActivity } from "../voice-browser";
import { VoiceControl } from "./VoiceControl";
import { DictationButton, DictationStrip } from "./Dictation";
import { insertAtCaret } from "../dictation";
import { useDictation } from "../use-dictation";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Streamdown, type DiagramPlugin } from "streamdown";
import { LuMenu, LuArrowDown, LuCheck, LuClock, LuCopy, LuFolderOpen, LuGlobe, LuSquareTerminal, LuSquare, LuFileText, LuArrowUp, LuAudioLines, LuPaperclip, LuPencil, LuRotateCw, LuTrash2, LuX } from "react-icons/lu";
import { api, type PiCommand, type PortalEvent, type PromptOptions, type Session } from "../api";
import { pending, refetchImage, sortFiles, uploadedNote, type Attachment } from "../attachments";
import { activity, buildTranscript, lastReplyId, type Item, type SentImage } from "../transcript";
import { HAS_MERMAID, loadMermaidPlugin } from "../mermaid";
import { useResolvedTheme } from "../theme";
import { ComposerBar } from "./ComposerBar";
import { confirmDialog } from "./ConfirmDialog";
import { moveHighlight, paletteMatches, slashToken } from "../slash-palette";
import { TerminalPanel } from "./TerminalPanel";
import { FilesPanel } from "./FilesPanel";
import { TitleInput } from "./TitleInput";
import { latestFileActivity } from "../file-activity";
import { drafts, withUnsent } from "../drafts";
import { local } from "../safe-storage";
import { copyText } from "../clipboard";
import { isClientCommand, isCommand } from "../client-commands";
import { isComposing, isEnter, isEscape, opensComposer, stopsRun } from "../shortcuts";

/** How many messages are drawn at first, and added each time you scroll up to the edge. */
const PAGE = 40;

const COMPOSER_HEIGHT_KEY = "pithagoras.composerHeight";
const DEFAULT_COMPOSER_HEIGHT = 72;
const MIN_COMPOSER_HEIGHT = 56;

function storedComposerHeight(): number {
  const stored = Number.parseInt(local.get(COMPOSER_HEIGHT_KEY) ?? "", 10);
  return Number.isFinite(stored) && stored >= MIN_COMPOSER_HEIGHT ? stored : DEFAULT_COMPOSER_HEIGHT;
}

function persistComposerHeight(height: number) {
  local.set(COMPOSER_HEIGHT_KEY, String(Math.round(height)));
}

/**
 * Context the portal attaches to a message, and what to call it.
 *
 * The agent needs to be told who is speaking and what it said while nobody was
 * talking to it. A person reading the transcript does not — they wrote the
 * message, so seeing their own words buried under three framing blocks is
 * noise. Folded away rather than dropped: it is still what the model saw, and
 * when a reply looks strange this is usually why.
 */
/** Keep in step with what the server attaches — see channels/supervisor.ts. */
const CONTEXT_BLOCKS: { tag: string; label: string }[] = [
  { tag: "speaker", label: "Speaker" },
  { tag: "sent-since-you-last-spoke", label: "Sent while idle" },
  { tag: "answer-from-primary", label: "Answer" },
  { tag: "channel-instructions", label: "Channel instructions" },
  { tag: "routine", label: "Routine" },
];

function splitContext(raw: string): { text: string; blocks: { label: string; body: string }[] } {
  let text = raw;
  const blocks: { label: string; body: string }[] = [];
  for (const { tag, label } of CONTEXT_BLOCKS) {
    // The opening tag may carry attributes, as <routine name="..."> does.
    const re = new RegExp(`<${tag}(\\s[^>]*)?>[\\s\\S]*?</${tag}>`, "g");
    text = text.replace(re, (match) => {
      const body = match
        .replace(new RegExp(`^<${tag}(\\s[^>]*)?>`), "")
        .replace(new RegExp(`</${tag}>$`), "")
        .trim();
      if (body) blocks.push({ label, body });
      return "";
    });
  }
  return { text: text.trim(), blocks };
}

function ContextChip({ label, body }: { label: string; body: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`rounded-full px-2 py-0.5 text-[11px] transition ${
          open
            ? "bg-accent/20 text-accent"
            : "bg-fg/5 text-fg-faint hover:bg-fg/10 hover:text-fg-muted"
        }`}
        title="Context the portal attached to this message"
      >
        {label}
      </button>
      {open && (
        <pre className="mt-1 w-full whitespace-pre-wrap rounded-lg bg-fg/5 p-2 text-left text-[11px] leading-relaxed text-fg-muted">
          {body}
        </pre>
      )}
    </>
  );
}

export function Chat({
  session,
  events,
  onSend,
  onEditMessage,
  onDeleteMessage,
  onAbort,
  onClientCommand,
  onRename,
  onOpenNavigation,
  loading,
  hasEarlier,
  loadingEarlier,
  onLoadEarlier,
}: {
  session: Session;
  events: PortalEvent[];
  /** The conversation is still arriving; drawing it now would show it half-built. */
  loading?: boolean;
  hasEarlier?: boolean;
  loadingEarlier?: boolean;
  onLoadEarlier?: () => void;
  onSend: (message: string, options?: PromptOptions) => Promise<void>;
  /** Replace a sent message: it and everything after it are dropped, and the new text is sent. */
  onEditMessage: (seq: number, message: string) => Promise<void>;
  /** Remove a sent message and the agent's answer to it. */
  onDeleteMessage: (seq: number) => Promise<void>;
  onAbort: () => Promise<void>;
  /** Builtins the portal itself services — /settings, /new, /name. */
  onClientCommand: (name: string, args: string) => void | Promise<void>;
  /** Give the chat another name, from its header. */
  onRename: (title: string) => Promise<void>;
  /** On a phone, where the sidebar is a drawer: opens it. */
  onOpenNavigation?: () => void;
}) {
  const [input, setInput] = useState(() => drafts.get(session.id));
  // Where dictated words go. Kept beside the state because several phrases can
  // arrive before React has drawn the first, and each must land after the last.
  const box = useRef<HTMLTextAreaElement>(null);
  const draft = useRef(input);
  draft.current = input;
  const caret = useRef<{ start: number; end: number } | null>(null);
  const caretTo = useRef<number | null>(null);
  const [voiceMode, setVoiceMode] = useState(false);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [voiceHost, setVoiceHost] = useState<HTMLDivElement | null>(null);
  const [sending, setSending] = useState(false);
  // Which sent message is being rewritten, and what went wrong with the last
  // thing done to one — shown in the transcript, where the message is.
  const [editing, setEditing] = useState<number | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // This is one component for every chat, so what belongs to one must be put
  // away when another opens: the words half written in the box (kept, and
  // there again when you come back), the message being rewritten — a number
  // that would name a different message here — and the last complaint.
  // Pictures waiting to go with the next message, kept per chat like the words.
  const [attached, setAttached] = useState<Attachment[]>(() => pending.get(session.id));
  // Pictures being read or files being uploaded: the message waits for them.
  const [adding, setAdding] = useState(0);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const [boxOf, setBoxOf] = useState(session.id);
  if (boxOf !== session.id) {
    setBoxOf(session.id);
    setInput(drafts.get(session.id));
    setAttached(pending.get(session.id));
    setEditing(null);
    setRenaming(false);
    setActionError(null);
  }
  const currentSession = useRef(session.id);
  currentSession.current = session.id;
  // Voice mode adds to and takes from the same pictures.
  useEffect(() => pending.subscribe((id) => {
    if (id === currentSession.current) setAttached(pending.get(id));
  }), []);
  const [panelRequest, setPanelRequest] = useState<"model" | "effort" | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const [composerHeight, setComposerHeight] = useState(storedComposerHeight);
  // Whether there is a browser to watch, and whether you are watching it. Asked
  // once — the answer only changes when somebody installs or removes one.
  const [browserUp, setBrowserUp] = useState(false);
  const [watching, setWatching] = useState(false);
  const [terminal, setTerminal] = useState(false);
  // The terminal panel holds two: what the agent ran, and a shell of your own.
  // The shell is only started once asked for, and kept while the panel is open.
  const [terminalTab, setTerminalTab] = useState<"agent" | "shell">("agent");
  const [shellStarted, setShellStarted] = useState(false);
  const [terminalFocus, setTerminalFocus] = useState<{ id: string; at: number } | null>(null);
  useEffect(() => {
    if (!terminal) setShellStarted(false);
  }, [terminal]);
  useEffect(() => {
    if (terminalTab === "shell" && terminal) setShellStarted(true);
  }, [terminalTab, terminal]);
  /** A command from the chat, found in the agent terminal. */
  const showInTerminal = (callId: string) => {
    setTerminalTab("agent");
    setTerminal(true);
    setTerminalFocus({ id: callId, at: Date.now() });
  };
  const [files, setFiles] = useState(false);
  // Whether Files has an edit that is not saved: closing it would lose it.
  const [filesDirty, setFilesDirty] = useState(false);
  const fileActivity = useMemo(() => latestFileActivity(events, session.workspace), [events, session.workspace]);
  useWorkPanels(
    { browser: !voiceMode && watching, terminal: !voiceMode && terminal, canvas: canvasOpen, files: !voiceMode && files },
    panel => { if (panel === "browser") setWatching(false); else if (panel === "terminal") setTerminal(false); else if (panel === "files") setFiles(false); else setCanvasOpen(false); },
    // A third panel closes another one instead, while Files has an edit in it.
    filesDirty ? ["files"] : [],
  );
  const closeFiles = async () => {
    if (
      filesDirty &&
      !(await confirmDialog({ title: "Discard your changes?", message: "The file open in Files has changes that are not saved.", confirmLabel: "Discard", danger: true }))
    ) {
      return;
    }
    setFiles(false);
  };
  // Beside the conversation, top to bottom in this order.
  const asidePanels = [watching && "browser", files && "files", terminal && "terminal"].filter(Boolean) as ("browser" | "files" | "terminal")[];
  const browserPane = useRef<HTMLDivElement>(null);

  // Kept across reloads: a width you dragged is a preference, and losing it on
  // every refresh makes the handle feel decorative.
  const [asideWidth, setAsideWidth] = useState(() => Number(local.get("panelWidth")) || 560);
  const [split, setSplit] = useState(() => Number(local.get("panelSplit")) || 0.55);
  useEffect(() => local.set("panelWidth", String(asideWidth)), [asideWidth]);
  useEffect(() => local.set("panelSplit", String(split)), [split]);

  /**
   * Dragging, on pointer events rather than mouse ones.
   *
   * Capture keeps the drag alive when the pointer crosses the iframe — without
   * it the frame swallows the move events and the panel stops following
   * halfway across.
   */
  const dragWidth = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = asideWidth;
    const move = (ev: PointerEvent) => {
      const next = startWidth - (ev.clientX - startX);
      setAsideWidth(Math.min(Math.max(next, 320), window.innerWidth * 0.75));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const dragSplit = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const ratio = (ev.clientY - box.top) / box.height;
      setSplit(Math.min(Math.max(ratio, 0.15), 0.85));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const scroller = useFollowBottom<HTMLDivElement>();
  const lastSpoken = useRef<string | null>(null);
  // Interrupted or failed, the process is gone: nothing it started is still going.
  const ended = session.status === "interrupted" || session.status === "error";
  const items = useMemo(() => buildTranscript(events, { ended }), [events, ended]);
  // What arrived while the chat was open slides in; what was there when it
  // opened, or was loaded from further up, is simply there.
  const entered = useRef<{ session: string; ready: boolean; at: Map<string, number> }>({ session: session.id, ready: false, at: new Map() });
  if (entered.current.session !== session.id) entered.current = { session: session.id, ready: false, at: new Map() };
  const arriving = (id: string, index: number) => {
    const e = entered.current;
    let at = e.at.get(id);
    if (at === undefined) {
      at = e.ready && index >= items.length - 3 ? performance.now() : 0;
      e.at.set(id, at);
    }
    return at > 0 && performance.now() - at < 700;
  };
  useEffect(() => {
    if (loading) return;
    for (const it of items) if (!entered.current.at.has(it.id)) entered.current.at.set(it.id, 0);
    entered.current.ready = true;
  }, [items, loading]);
  // The last thing the person said. Retrying it replaces it and what came of
  // it, which is only safe where nothing follows that would go too.
  const lastSaid = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.kind === "user" && !it.queued && !it.unsent && (splitContext(it.text).text || it.images)) return it.id;
    }
    return undefined;
  }, [items]);
  const lastReply = useMemo(() => lastReplyId(items), [items]);

  // Only the end of a conversation is drawn to begin with. Drawing all of a long
  // one is what made opening it slow, and the top of it is not what anybody
  // opens it for. Earlier messages are added as you scroll towards them.
  const [shown, setShown] = useState(PAGE);
  // Reading above the end: what is appended must not push the oldest message
  // drawn out of the window, and with it whatever is being read. The window
  // grows by what was added instead; at the end it slides along as before.
  const [tail, setTail] = useState<{ id?: string; count: number }>({ count: 0 });
  const lastId = items.length ? items[items.length - 1].id : undefined;
  if (lastId !== tail.id || items.length !== tail.count) {
    let appended = 0;
    if (tail.id && lastId !== tail.id) {
      for (let i = items.length - 1; i >= 0 && items[i].id !== tail.id; i--) appended++;
      // The one that was last is gone, so this is not something added after it.
      if (appended === items.length) appended = 0;
    }
    if (appended > 0 && !scroller.following.current) setShown((n) => n + appended);
    setTail({ id: lastId, count: items.length });
  }
  const visible = shown >= items.length ? items : items.slice(items.length - shown);
  const hiddenHere = items.length - visible.length;
  const topEdge = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  /**
   * The message being read when earlier ones were requested, and where it sat.
   * Messages are added above it, and their height keeps changing for a moment
   * (markdown and code blocks settle after they mount), so the view is kept on
   * that message rather than on a scroll offset worked out once.
   */
  const reading = useRef<{ el: Element; offset: number; first?: string; count: number; until: number } | null>(null);
  const reveal = () => {
    const box = scroller.ref.current;
    if (box && list.current) {
      const top = box.getBoundingClientRect().top;
      // A message, not the edge or the button above them: those come and go.
      const el = [...list.current.children].find(
        (k) => k !== topEdge.current && !k.hasAttribute("data-earlier") && k.getBoundingClientRect().bottom > top + 1,
      );
      reading.current = el
        ? { el, offset: el.getBoundingClientRect().top - top, first: visible[0]?.id, count: items.length, until: Infinity }
        : null;
    }
    if (hiddenHere > 0) setShown((n) => n + PAGE);
    else if (hasEarlier && !loadingEarlier) onLoadEarlier?.();
  };
  const keepPlace = () => {
    const box = scroller.ref.current;
    const r = reading.current;
    if (!box || !r) return;
    if (performance.now() > r.until || !r.el.isConnected) {
      reading.current = null;
      return;
    }
    // Nothing has been added yet — the request is still on its way.
    if (r.until === Infinity) return;
    const drift = r.el.getBoundingClientRect().top - box.getBoundingClientRect().top - r.offset;
    if (Math.abs(drift) >= 1) box.scrollTop += drift;
  };
  const revealNow = useRef(reveal);
  revealNow.current = reveal;
  // A different conversation starts from its end again. Only `shown`: what was
  // last said follows from the events, and clearing it here as well would make
  // the first update after opening look like a message just sent — and pull the
  // view to the end from wherever it was being read.
  useEffect(() => {
    setShown(PAGE);
  }, [session.id]);
  // Added above without moving what is being read.
  useLayoutEffect(() => {
    const r = reading.current;
    // What was asked for has arrived: from here the place is held while it settles.
    if (r && r.until === Infinity && (visible[0]?.id !== r.first || items.length !== r.count)) {
      r.until = performance.now() + 1500;
    }
    keepPlace();
  });
  useEffect(() => {
    if (!list.current) return;
    const observer = new ResizeObserver(keepPlace);
    observer.observe(list.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const root = scroller.ref.current;
    const edge = topEdge.current;
    if (!root || !edge || loading) return;
    if (hiddenHere === 0 && (!hasEarlier || loadingEarlier)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) revealNow.current();
      },
      { root, rootMargin: "600px 0px 0px 0px" },
    );
    observer.observe(edge);
    return () => observer.disconnect();
  }, [loading, hiddenHere, hasEarlier, loadingEarlier, shown]);


  // Diagrams: the plugin is only fetched once a reply actually contains a
  // mermaid fence, and mermaid bakes its palette into the SVG, so it is handed
  // the theme rather than left to guess at dark text on a dark background.
  const wantsMermaid = useMemo(
    () => items.some((item) => item.kind === "assistant" && HAS_MERMAID.test(item.text ?? "")),
    [items],
  );
  const [mermaid, setMermaid] = useState<DiagramPlugin | null>(null);
  const theme = useResolvedTheme();
  const mermaidOptions = useMemo(
    () => ({ config: { theme: theme === "light" ? ("default" as const) : ("dark" as const) } }),
    [theme],
  );

  useEffect(() => {
    if (!wantsMermaid || mermaid) return;
    let live = true;
    loadMermaidPlugin().then(
      (plugin) => live && setMermaid(plugin),
      // A failed chunk fetch leaves the fence as a code block, which is still
      // readable — better than an error where the answer should be.
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [wantsMermaid, mermaid]);
  const running = session.status === "running";

  // What it is doing, and for how long. The clock ticks only while something is
  // running, so an idle session re-renders no more than it used to.
  const phase = useMemo(() => (running ? activity(events) : null), [running, events]);
  // The thinking block and the compaction marker already say so, animated,
  // where it is happening; the status pill would say it twice.
  const statusShownElsewhere = useMemo(() => {
    const last = items[items.length - 1];
    if (!last) return false;
    if (last.kind === "compaction" && last.status === "running") return true;
    return phase?.label === "thinking" && last.kind === "assistant" && !last.done && !!last.thinking && !last.text;
  }, [items, phase]);
  // What tells the composer that pi has a new token count to show. A compaction
  // moves it too, and it is not a turn.
  const turns = useMemo(
    () => events.reduce((n, e) => n + (e.type === "turn_end" || e.type === "compaction_end" ? 1 : 0), 0),
    [events],
  );
  // A notice is the portal speaking, not a message: only what a person or pi
  // said counts. Earlier pages that are not loaded yet count as said.
  const started = useMemo(
    () => hasEarlier || items.some((item) => item.kind === "user" || item.kind === "assistant"),
    [items, hasEarlier],
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  // Commands come from pi at runtime, so anything a newly installed package
  // registers shows up here without the portal knowing about it in advance.
  //
  // Asked for only once a "/" is typed. Listing them starts pi for the chat,
  // and it stays up — so fetching them on open started a runtime for every chat
  // looked at, which the config route goes out of its way not to do.
  const [commands, setCommands] = useState<PiCommand[]>([]);
  const commandList = useRef<{ key: string; list: Promise<PiCommand[]> } | null>(null);
  /** The commands for this chat, fetched once per chat and again after each run. */
  const loadCommands = (): Promise<PiCommand[]> => {
    // A run can install an extension, whose commands should then be offered.
    const key = `${session.id}:${turns}`;
    if (commandList.current?.key !== key) {
      const list = api.commands(session.id).then(
        (r) => r.commands,
        () => [] as PiCommand[],
      );
      commandList.current = { key, list };
    }
    // Shown every time, not only when fetched: opening another chat empties
    // the list, and coming back finds this chat's still here to be offered.
    const { list } = commandList.current;
    void list.then((found) => {
      if (commandList.current?.key === key) setCommands(found);
    });
    return list;
  };
  // What was listed for another chat is not offered here.
  useEffect(() => setCommands([]), [session.id]);

  // Show the palette while the composer holds a bare "/name" prefix.
  const slashText = slashToken(input);
  const wantsCommands = slashText !== null;
  useEffect(() => {
    if (wantsCommands) void loadCommands();
  }, [wantsCommands, session.id, turns]);
  const allMatches = useMemo(
    () => (slashText === null ? [] : paletteMatches(commands, slashText)),
    [commands, slashText],
  );
  /** Escape puts the list away until something else is typed. */
  const [paletteShut, setPaletteShut] = useState(false);
  /** Which command Enter runs and Tab completes; the first until an arrow says otherwise. */
  const [picked, setPicked] = useState(0);
  useEffect(() => {
    setPicked(0);
    setPaletteShut(false);
  }, [slashText]);
  const matches = paletteShut ? [] : allMatches;
  const paletteRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    paletteRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [picked, matches.length]);
  /** What is left in the box once a command is chosen: its name, ready for arguments. */
  const complete = (c: PiCommand) => {
    caret.current = null;
    changeInput(`/${c.name} `);
  };

  useEffect(() => {
    // Only offered where it would work: an iframe needs a secure context, and
    // over plain HTTP the client inside it refuses to start.
    if (!window.isSecureContext) return;
    api
      .browser()
      .then((b) => setBrowserUp(b.install.container === "running"))
      .catch(() => setBrowserUp(false));
  }, []);

  useLayoutEffect(() => {
    // Stay at the end while the agent writes — unless you scrolled up to read,
    // which new output must not undo. Something you just said, and the first
    // paint of a conversation, always go to the end — before it is painted, so
    // the top of it is never seen, nor new content at the old scroll position.
    let said: string | null = null;
    for (let i = items.length - 1; i >= 0 && !said; i--) if (items[i].kind === "user") said = items[i].id;
    const fresh = said !== lastSpoken.current;
    lastSpoken.current = said;
    scroller.follow(fresh);
  }, [items.length, events.length]);

  useEffect(() => () => resizeCleanupRef.current?.(), []);

  const startComposerResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    resizeCleanupRef.current?.();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const maxHeight = Math.round(window.innerHeight * 0.45);
    const startHeight = Math.min(maxHeight, box.current?.getBoundingClientRect().height ?? composerHeight);

    const move = (moveEvent: PointerEvent) => {
      setComposerHeight(Math.max(MIN_COMPOSER_HEIGHT, Math.min(maxHeight, startHeight + startY - moveEvent.clientY)));
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      resizeCleanupRef.current = null;
    };
    const finish = () => {
      cleanup();
      persistComposerHeight(box.current?.getBoundingClientRect().height ?? composerHeight);
    };

    resizeCleanupRef.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
  };

  /**
   * Send `msg` as a message, or run it if it is one of the portal's own commands.
   *
   * What came from the box is taken out of it at once, so that it does not sit
   * there looking unsent while it is on its way — and put back if it does not
   * get there. Throws, for the caller to say what went wrong.
   */
  const submit = async (msg: string, fromBox: boolean) => {
    const sent = session.id;
    // Some builtins are UI, not prompts: /model opens the picker the pill uses,
    // /settings opens the modal. Sending them to pi would just be a chat line.
    const parsed = /^\/([\w:-]+)\s*(.*)$/.exec(msg);
    const command = parsed && isClientCommand(parsed[1], commands) ? parsed : null;
    // The pictures in the box go with what came from it, and nothing else. A
    // command is run rather than said — this one here, any other by pi — so
    // they stay in the box for later rather than going where nothing shows them.
    const keepsPictures = parsed !== null && isCommand(parsed[1], commands);
    const images = fromBox && !keepsPictures ? attached : [];

    if (fromBox) {
      if (keepsPictures) {
        caret.current = null;
        changeInput("");
      } else clearBox();
    }
    try {
      if (command) {
        if (command[1] === "model") setPanelRequest("model");
        else await onClientCommand(command[1], command[2]);
        return;
      }
      setSending(true);
      try {
        // Mid-run, typed words steer the run — taken in after the step it is on
        // — rather than waiting for it to finish, which on a long run looked
        // like the message had gone nowhere. Voice mode has its own switch.
        const steer = running && !voiceMode;
        await onSend(
          msg,
          voiceMode || images.length || steer
            ? { voice: voiceMode || undefined, images: images.length ? images : undefined, steer: steer || undefined }
            : undefined,
        );
      } finally {
        setSending(false);
      }
    } catch (e) {
      if (fromBox) putBack(sent, msg, images);
      throw e;
    }
  };

  /** A message that did not go, back where it was typed — in that chat, if you have left it. */
  const putBack = (id: string, msg: string, images: Attachment[] = []) => {
    const back = [...images, ...pending.get(id)];
    if (currentSession.current === id) {
      changeInput(msg ? withUnsent(draft.current, msg) : draft.current);
      changeAttached(back);
    } else {
      if (msg) drafts.set(id, withUnsent(drafts.get(id), msg));
      pending.set(id, back);
    }
  };

  /** A message from the conversation, with its pictures, sent as a new one. */
  const sendAgain = async (item: { images?: SentImage[] }, text: string) => {
    const images = await Promise.all(
      (item.images ?? []).map((image) => refetchImage(api.imageUrl(session.id, image.name), "A picture")),
    );
    // Into a run that is going, the same as typing it again would.
    const steer = running && !voiceMode;
    await onSend(text, images.length || steer ? { images: images.length ? images : undefined, steer: steer || undefined } : undefined);
  };

  const attempt = async (fn: () => Promise<void>) => {
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError((e as Error).message);
    }
  };

  const send = async () => {
    const msg = input.trim();
    if ((!msg && !attached.length) || sending || adding) return;
    await attempt(() => submit(msg, true));
  };

  const changeAttached = (next: Attachment[]) => {
    pending.set(session.id, next);
    setAttached(next);
  };

  /**
   * Pictures and files pasted, dropped or picked. Pictures wait in the box to
   * go with the message; anything else is put in the chat's folder at once and
   * the message says so, so the agent knows to look.
   */
  const addFiles = async (files: File[]) => {
    if (!files.length) return;
    const id = session.id;
    const { images, others } = sortFiles(files);
    setActionError(null);
    setAdding((n) => n + 1);
    const problems: string[] = [];
    try {
      problems.push(...(await pending.add(id, images)));
      const uploaded: string[] = [];
      for (const file of others) {
        try {
          uploaded.push((await api.uploadFile(id, "", file)).path);
        } catch (e) {
          problems.push((e as Error).message);
        }
      }
      const note = uploadedNote(uploaded);
      if (note) {
        if (currentSession.current === id) changeInput(draft.current.trim() ? `${draft.current.trimEnd()}\n${note}` : note);
        else drafts.set(id, drafts.get(id).trim() ? `${drafts.get(id).trimEnd()}\n${note}` : note);
      }
    } finally {
      setAdding((n) => n - 1);
      if (problems.length && currentSession.current === id) setActionError(problems.join(" "));
    }
  };

  /** Every change to the box goes through here, so that the draft is kept as it is typed. */
  const changeInput = (next: string) => {
    drafts.set(session.id, next);
    setInput(next);
  };

  const clearBox = () => {
    caret.current = null;
    changeInput("");
    changeAttached([]);
  };

  /** Dictated words, put in the box where the cursor was and the cursor left after them. */
  const insertSpoken = (text: string) => {
    const at = caret.current ?? { start: draft.current.length, end: draft.current.length };
    const next = insertAtCaret(draft.current, at.start, at.end, text);
    draft.current = next.value;
    caret.current = { start: next.caret, end: next.caret };
    caretTo.current = next.caret;
    changeInput(next.value);
  };
  useLayoutEffect(() => {
    if (caretTo.current === null) return;
    box.current?.setSelectionRange(caretTo.current, caretTo.current);
    caretTo.current = null;
  }, [input]);

  // "/" from anywhere on the page: the box, with the command list open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Not behind a dialog: the box is not what is being talked to.
      if (voiceMode || document.querySelector('[aria-modal="true"]')) return;
      if (!opensComposer({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, target })) return;
      e.preventDefault();
      box.current?.focus();
      if (!draft.current.trim()) changeInput("/");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [voiceMode, session.id]);

  // Phrases sent as they are said go one at a time: a second must not overtake
  // the first, and one that fails goes back in the box rather than being lost.
  const spoken = useRef<Promise<unknown>>(Promise.resolve());
  const sendSpoken = (text: string) => {
    spoken.current = spoken.current.then(async () => {
      try {
        await submit(text, false);
      } catch {
        insertSpoken(text);
      }
    });
  };
  const dictation = useDictation({
    sessionId: session.id,
    disabled: voiceMode,
    onText: insertSpoken,
    onSend: sendSpoken,
  });
  // One microphone: voice mode takes over from dictation.
  useEffect(() => {
    if (voiceMode) void dictation.stop();
  }, [voiceMode, dictation.stop]);

  return (
    <div className="session-workspace relative flex h-full min-h-0 flex-col">
      <CanvasPanel showToggle={false} key={session.id} sessionId={session.id} folder={session.workspace} open={canvasOpen} setOpen={setCanvasOpen}/>
      <div ref={setVoiceHost} className={voiceMode ? "flex min-h-0 flex-1 flex-col" : "hidden"} />
      <header className={voiceMode ? "hidden" : "chat-header border-b border-line px-4 py-3 max-md:px-3 max-md:py-2"}>
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 max-md:gap-2">
        {onOpenNavigation && (
          <button type="button" aria-label="Open navigation" aria-controls="mobile-navigation" onClick={onOpenNavigation} className="-ml-1 rounded-lg p-2 text-fg hover:bg-fg/10 md:hidden">
            <LuMenu size={20} aria-hidden />
          </button>
        )}
        <div className="min-w-0 flex-1">
          {renaming ? (
            <TitleInput
              value={session.title}
              label="Chat name"
              className="w-full text-sm font-medium"
              onCommit={(next) => {
                setRenaming(false);
                void attempt(() => onRename(next));
              }}
              onCancel={() => setRenaming(false)}
            />
          ) : (
            <h2 className="truncate text-sm font-medium text-fg">
              <button
                type="button"
                onClick={() => setRenaming(true)}
                title="Rename this chat"
                className="max-w-full truncate rounded text-left hover:text-accent"
              >
                {session.title}
              </button>
            </h2>
          )}
          <p className="truncate font-mono text-[11px] text-fg-faint">{session.workspace}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {session.status === "interrupted" && (
            <span className="rounded-md bg-warn/10 px-2 py-0.5 text-[11px] text-warn">
              interrupted — send a message to resume
            </span>
          )}
          {browserUp && (
            <button
              onClick={() => setWatching((v) => !v)}
              aria-label="Browser"
              aria-expanded={watching}
              title={
                watching ? "Hide the browser" : "Watch the browser the agent is driving"
              }
              className={`rounded-lg border px-2 py-1 text-xs transition ${
                watching
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "border-line text-fg-muted hover:bg-fg/5 hover:text-fg"
              }`}
            >
              <LuGlobe className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={() => setTerminal((v) => !v)}
            aria-label="Terminal"
            aria-expanded={terminal}
            title={terminal ? "Hide the terminal" : "The agent's terminal, and a shell of your own in this workspace"}
            className={`rounded-lg border px-2 py-1 text-xs transition ${
              terminal
                ? "border-accent/40 bg-accent/10 text-accent"
                : "border-line text-fg-muted hover:bg-fg/5 hover:text-fg"
            }`}
          >
            <LuSquareTerminal className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => (files ? void closeFiles() : setFiles(true))}
            aria-label="Files"
            aria-expanded={files}
            title={files ? "Hide the files" : "Browse the files in this chat's folder"}
            className={`rounded-lg border px-2 py-1 text-xs transition ${
              files
                ? "border-accent/40 bg-accent/10 text-accent"
                : "border-line text-fg-muted hover:bg-fg/5 hover:text-fg"
            }`}
          >
            <LuFolderOpen className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => setCanvasOpen(v => !v)} aria-label="Session canvases" title="Session canvases" aria-expanded={canvasOpen}
            className={`rounded-lg border px-2 py-1 text-xs transition ${canvasOpen ? 'border-accent/40 bg-accent/10 text-accent' : 'border-line text-fg-muted hover:bg-fg/5 hover:text-fg'}`}>
            <LuFileText className="h-3.5 w-3.5" />
          </button>
        </div>
        </div>
      </header>

      <div className={voiceMode ? "hidden" : "relative flex min-h-0 flex-1"}>
      <div className="flex min-w-0 flex-1 flex-col">
      <div
        ref={scroller.ref}
        onScroll={scroller.onScroll}
        // Reading takes over from the automatic placement.
        onWheel={() => (reading.current = null)}
        onTouchStart={() => (reading.current = null)}
        onKeyDown={() => (reading.current = null)}
        onPointerDown={() => (reading.current = null)}
        className="flex-1 overflow-y-auto px-4 py-6"
      >
        <div ref={list} className="chat-list mx-auto w-full max-w-3xl space-y-3">
        <div ref={topEdge} aria-hidden className="h-px" />
        {!loading && hasEarlier && hiddenHere === 0 && (
          <div data-earlier="" className="flex justify-center pb-2">
            <button
              onClick={onLoadEarlier}
              disabled={loadingEarlier}
              className="rounded-lg border border-line px-3 py-1 text-xs text-fg-muted transition hover:bg-fg/5 hover:text-fg disabled:opacity-50"
            >
              {loadingEarlier ? "Loading…" : "Load earlier messages"}
            </button>
          </div>
        )}

        {loading && (
          <p role="status" className="pt-16 text-center text-sm text-fg-muted">
            Loading the conversation…
          </p>
        )}

        {!loading && items.length === 0 && (
          <div className="pt-16 text-center">
            <p className="text-sm text-fg-muted">Give pi a task.</p>
            <p className="mt-1 text-xs text-fg-faint">You can close this tab — it keeps working.</p>
          </div>
        )}

        {(loading ? [] : visible).map((item, index) => {
          const enter = arriving(item.id, hiddenHere + index) ? " chat-enter" : "";
          if (item.kind === "user") {
            const { text, blocks } = splitContext(item.text);
            // Nothing but framing: the portal spoke, not a person. Drawing it as
            // a message bubble with no message in it reads as something broken.
            if (!text && !item.images) {
              return (
                <div key={item.id} className="flex flex-wrap justify-end gap-1">
                  {blocks.map((b, i) => (
                    <ContextChip key={i} label={b.label} body={b.body} />
                  ))}
                </div>
              );
            }
            if (editing === item.seq) {
              return (
                <div key={item.id} className="flex justify-end">
                  <MessageEditor
                    initial={text}
                    hasImages={!!item.images}
                    onCancel={() => setEditing(null)}
                    onSave={(next) =>
                      attempt(async () => {
                        await onEditMessage(item.seq, next);
                        setEditing(null);
                      })
                    }
                  />
                </div>
              );
            }
            // Sent into the run and waiting for the agent to take it in: shown
            // as sent, at the foot of the conversation, and moved to where it
            // was read once it has been. Nothing to edit or retry until then —
            // and one that never got there can only be sent again. Waiting
            // until the server says otherwise, run or no run: pi can still
            // hold one after its run is over, or be taking it in, and offered
            // again it would be read twice.
            if (item.queued || item.unsent) {
              const waits = !item.unsent;
              return (
                <div key={item.id} className={`group flex flex-col items-end gap-1${enter}`}>
                  <div className="max-w-[80%] rounded-2xl rounded-br-md border border-dashed border-accent/30 bg-accent/5 px-3.5 py-2 text-sm text-fg-muted">
                    {text && <div className="whitespace-pre-wrap">{text}</div>}
                    {item.images && <div className="mt-1 text-[11px] text-fg-subtle">{item.images.length === 1 ? "1 picture" : `${item.images.length} pictures`}</div>}
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
                    {waits ? (
                      <>
                        <LuClock aria-hidden className="h-3 w-3" />
                        <span>
                          {running
                            ? `Waiting — goes in ${item.steer ? "after the current step" : "when the run ends"}`
                            : "Waiting — the agent has it, and reads it next"}
                        </span>
                      </>
                    ) : (
                      <span>
                        {item.unsent === "unsure"
                          ? "May not have been sent — the portal restarted, and could not tell whether the agent took it in"
                          : `Not sent — ${item.unsent === "restarted" ? "the portal restarted" : "the run was stopped"} before the agent took it in`}
                      </span>
                    )}
                    {text && <CopyAction text={text} />}
                    {!waits && (
                      <MessageAction label="Send again as a new message" onClick={() => attempt(() => sendAgain(item, text))}>
                        <LuRotateCw className="h-3 w-3" />
                      </MessageAction>
                    )}
                  </div>
                </div>
              );
            }
            return (
              <div key={item.id} className={`group flex flex-col items-end gap-1${enter}`}>
                <div className="max-w-[80%] rounded-2xl rounded-br-md bg-accent/10 px-3.5 py-2 text-sm text-fg ring-1 ring-inset ring-accent/15">
                  {item.audio && <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium tracking-wide text-accent" title="Sent in voice mode"><LuAudioLines size={13} aria-hidden="true" /><span>Audio</span></div>}
                  {item.images && (
                    <div className={`flex flex-wrap justify-end gap-1.5 ${text ? "mb-1.5" : ""}`}>
                      {item.images.map((image) => (
                        <a key={image.name} href={api.imageUrl(session.id, image.name)} target="_blank" rel="noreferrer" title="Open the picture">
                          <img
                            src={api.imageUrl(session.id, image.name)}
                            alt="A picture sent with this message"
                            loading="lazy"
                            className="max-h-48 max-w-full rounded-lg object-contain ring-1 ring-line"
                          />
                        </a>
                      ))}
                    </div>
                  )}
                  {text && <div className="whitespace-pre-wrap">{text}</div>}
                  {blocks.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap justify-end gap-1">
                      {blocks.map((b, i) => (
                        <ContextChip key={i} label={b.label} body={b.body} />
                      ))}
                    </div>
                  )}
                </div>
                {/* Only where it can be done: taking a message out from under a
                    run that is answering it leaves the agent replying to
                    something that no longer exists. Sending it again is fine —
                    it just queues, like any other message. */}
                <div className="flex items-center gap-0.5 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                  {text && <CopyAction text={text} />}
                  {item.id === lastSaid ? (
                    // Retry: the same as editing without changing a word. After
                    // a Stop this is what clears the half-finished answer out of
                    // the agent's memory instead of stacking a second question
                    // on top of it.
                    <MessageAction
                      label={
                        running
                          ? "Stop the run to retry"
                          : "Retry — drops the reply and sends this message again"
                      }
                      disabled={running}
                      onClick={() => attempt(() => onEditMessage(item.seq, text))}
                    >
                      <LuRotateCw className="h-3 w-3" />
                    </MessageAction>
                  ) : (
                    <MessageAction
                      label="Send again as a new message"
                      onClick={() => attempt(() => sendAgain(item, text))}
                    >
                      <LuRotateCw className="h-3 w-3" />
                    </MessageAction>
                  )}
                  <MessageAction
                    label={
                      running
                        ? "Stop the run to edit"
                        : `Edit — replaces this message and everything after it${item.id === lastSaid ? " (↑ in an empty box)" : ""}`
                    }
                    disabled={running}
                    onClick={() => setEditing(item.seq)}
                  >
                    <LuPencil className="h-3 w-3" />
                  </MessageAction>
                  <MessageAction
                    label={running ? "Stop the run to delete" : "Delete this message and the reply to it"}
                    disabled={running}
                    danger
                    onClick={async () => {
                      if (
                        await confirmDialog({
                          title: "Delete this message?",
                          message: "The agent's reply to it goes too, and the agent forgets both.",
                          confirmLabel: "Delete",
                          danger: true,
                          deletes: true,
                        })
                      )
                        attempt(() => onDeleteMessage(item.seq));
                    }}
                  >
                    <LuTrash2 className="h-3 w-3" />
                  </MessageAction>
                </div>
              </div>
            );
          }
          if (item.kind === "assistant") {
            return (
              // Never closer than 2rem to the edge: Copy sits in that margin,
              // and 10% of a phone is less than the button.
              <div key={item.id} className={`group max-w-[min(90%,calc(100%_-_2rem))]${enter}`}>
                {item.thinking && (
                  <ThinkingBlock
                    thinking={item.thinking}
                    streaming={running && !item.done && !item.text}
                    since={item.thinkingSince}
                    until={item.thinkingUntil}
                  />
                )}
                {item.text && (
                  <div className="md relative text-sm leading-relaxed text-fg">
                    {/* Streamdown rather than plain markdown: a reply arrives a
                        token at a time, so half of it is briefly malformed —
                        an unclosed fence, a half-written link — and a strict
                        renderer flickers between interpretations as it lands.
                        A reasoning model also sometimes closes a thought inside
                        the answer; that stray tag is noise to whoever reads it. */}
                    <Streamdown
                      parseIncompleteMarkdown
                      animated={{ animation: "blurIn", duration: 240, sep: "word" }}
                      isAnimating={running && !item.done}
                      caret={running && !item.done ? "circle" : undefined}
                      shikiTheme={["github-light", "github-dark"]}
                      plugins={mermaid ? { mermaid } : undefined}
                      mermaid={mermaidOptions}
                    >
                      {assistantText(item)}
                    </Streamdown>
                    {/* Only the last bubble of the reply: one per tool call in
                        between would be a Copy button after every paragraph.
                        Beside the words rather than under them, so it adds no
                        line of its own — and beside the words, not the
                        thinking above them. */}
                    {item.id === lastReply && (
                      <div className="absolute -right-7 top-0 flex items-center opacity-0 transition focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                        <CopyAction text={assistantText(item)} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          }
          if (item.kind === "compaction") {
            return (
              <div key={item.id} className={`chat-row${enter}`}>
                <CompactionMarker item={item} />
              </div>
            );
          }
          if (item.kind === "tool") {
            return (
              <div key={item.id} className={`tool-row${enter}`}>
              <ToolCall item={item} onOpenTerminal={showInTerminal} />
              {item.picture && (
                <a
                  href={api.pictureUrl(session.id, item.picture.path, item.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="mb-1 mt-0.5 block w-fit"
                  title={item.picture.title ?? item.picture.path}
                >
                  <img
                    src={api.pictureUrl(session.id, item.picture.path, item.id)}
                    alt={item.picture.title ?? item.picture.path}
                    loading="lazy"
                    className="max-h-80 max-w-full rounded-lg border border-line object-contain"
                  />
                </a>
              )}
              </div>
            );
          }
          return (
            <div
              key={item.id}
              className={`whitespace-pre-wrap rounded-lg px-3 py-2 text-xs${enter} ${
                item.tone === "error"
                  ? "bg-danger/10 text-danger"
                  : "bg-raised/60 text-fg-muted"
              }`}
            >
              {item.text}
            </div>
          );
        })}

          {actionError && (
            <div className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{actionError}</div>
          )}
          {!loading && running && phase && !statusShownElsewhere && <StatusIndicator phase={phase} now={now} />}
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        onDragOver={(e) => {
          // The voice stage is portaled from inside this form, and React
          // bubbles its drags here too; whatever took them already handled it.
          if (e.defaultPrevented || !e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          // Down whatever was dropped: a drag that looked like files can carry
          // none, and the overlay would stay up until the next one left.
          setDragging(false);
          if (e.defaultPrevented || !e.dataTransfer.files.length) return;
          e.preventDefault();
          void addFiles([...e.dataTransfer.files]);
        }}
        className="px-4 pb-4 pt-2 sm:px-6 sm:pb-5"
      >
        <div className="prompt-shell relative mx-auto w-full max-w-3xl">
        {/* Scrolled up to read, the way back to the end is one click rather
            than a long drag — and during a run, where the new output is. */}
        {scroller.away && !loading && matches.length === 0 && (
          <button
            type="button"
            onClick={() => {
              reading.current = null;
              scroller.follow(true);
            }}
            className="absolute bottom-full left-1/2 z-10 mb-2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-line bg-surface px-3 py-1 text-xs text-fg-muted shadow-pop transition hover:text-fg"
          >
            <LuArrowDown aria-hidden className="h-3.5 w-3.5" />
            {running ? "Latest output" : "Jump to the end"}
          </button>
        )}
        {matches.length > 0 && (
          <div
            ref={paletteRef}
            role="listbox"
            aria-label="Commands"
            className="absolute bottom-full left-0 right-0 mb-2 max-h-[min(18rem,35dvh)] overflow-y-auto overscroll-contain rounded-xl border border-line bg-surface shadow-pop"
          >
            {matches.map((c, i) => (
              <button
                key={c.name}
                type="button"
                role="option"
                aria-selected={i === picked}
                onMouseEnter={() => setPicked(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  complete(c);
                }}
                className={`flex w-full items-baseline gap-2 px-3 py-2 text-left transition ${
                  i === picked ? "bg-fg/5" : ""
                }`}
              >
                <span className="font-mono text-xs text-accent">/{c.name}</span>
                <span className="truncate text-xs text-fg-subtle">{c.description}</span>
                <span className="ml-auto shrink-0 text-[10px] text-fg-faint">{c.source}</span>
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          onPointerDown={startComposerResize}
          onKeyDown={(event) => {
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
            event.preventDefault();
            const maxHeight = Math.round(window.innerHeight * 0.45);
            const direction = event.key === "ArrowUp" ? 16 : -16;
            const nextHeight = Math.max(MIN_COMPOSER_HEIGHT, Math.min(maxHeight, composerHeight + direction));
            setComposerHeight(nextHeight);
            persistComposerHeight(nextHeight);
          }}
          aria-label="Resize message composer vertically"
          aria-valuemin={MIN_COMPOSER_HEIGHT}
          aria-valuemax={Math.round(window.innerHeight * 0.45)}
          aria-valuenow={Math.round(composerHeight)}
          title="Drag up or down to resize"
          className="group flex h-3 w-full touch-none cursor-ns-resize items-center justify-center"
        >
          <span className="h-1 w-12 rounded-full bg-fg/15 transition group-hover:bg-accent/60" />
        </button>
        <DictationStrip dictation={dictation} />
        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-2xl border-2 border-dashed border-accent/60 bg-accent/10 text-xs text-accent">
            Drop pictures to send them, or files to put them in the folder
          </div>
        )}
        {(attached.length > 0 || adding > 0) && (
          <div className="flex flex-wrap items-center gap-2 px-3 pt-3" aria-label="Pictures going with the message">
            {attached.map((a) => (
              <div key={a.id} className="group/att relative">
                <img src={a.data} alt={a.name} title={a.name} className="h-14 w-14 rounded-lg object-cover ring-1 ring-line" />
                <button
                  type="button"
                  onClick={() => changeAttached(attached.filter((x) => x.id !== a.id))}
                  aria-label={`Remove ${a.name}`}
                  title="Remove"
                  className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-surface text-fg-muted shadow ring-1 ring-line transition hover:text-danger"
                >
                  <LuX aria-hidden className="h-3 w-3" />
                </button>
              </div>
            ))}
            {adding > 0 && <span role="status" className="text-[11px] text-fg-subtle">Adding…</span>}
          </div>
        )}
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            void addFiles(files);
          }}
        />
        <textarea
          ref={box}
          value={input}
          onChange={(e) => {
            caret.current = { start: e.target.selectionStart, end: e.target.selectionEnd };
            changeInput(e.target.value);
          }}
          onSelect={(e) => {
            caret.current = { start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd };
          }}
          onPaste={(e) => {
            // A screenshot, or "Copy image" in a browser. Where there is text as
            // well — cells copied from a spreadsheet come with a picture of
            // themselves — the text is what was meant.
            const files = [...e.clipboardData.files];
            if (!files.length || e.clipboardData.getData("text/plain")) return;
            e.preventDefault();
            void addFiles(files);
          }}
          onKeyDown={(e) => {
            if (matches.length > 0 && !isComposing(e)) {
              const chosen = matches[Math.min(picked, matches.length - 1)];
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setPicked((i) => moveHighlight(i, e.key === "ArrowDown" ? 1 : -1, matches.length));
                return;
              }
              if (e.key === "Tab" && !e.shiftKey) {
                e.preventDefault();
                complete(chosen);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setPaletteShut(true);
                return;
              }
              // The command that is lit runs, rather than the half of its name
              // that was typed going to the agent as a message. One that cannot
              // do anything without an argument waits for it instead.
              if (isEnter(e) && !e.shiftKey) {
                e.preventDefault();
                if (sending) return;
                if (chosen.needsArgument) complete(chosen);
                else void attempt(() => submit(`/${chosen.name}`, true));
                return;
              }
            }
            // Up in an empty box opens what you last said for rewriting, as in
            // most chat programs — the quick way to fix a typo just sent.
            if (
              e.key === "ArrowUp" &&
              !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey &&
              !isComposing(e) &&
              !input && !attached.length && !running
            ) {
              const last = items.find((it) => it.id === lastSaid);
              if (last?.kind === "user") {
                e.preventDefault();
                setEditing(last.seq);
                return;
              }
            }
            if (
              stopsRun({
                key: e.key,
                running,
                composing: isComposing(e),
                paletteOpen: matches.length > 0,
              })
            ) {
              e.preventDefault();
              void attempt(onAbort);
              return;
            }
            if (isEnter(e) && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          placeholder={
            dictation.active
              ? "Speak — your words appear here…"
              : running
                ? "pi is working — what you send goes into the run after its current step…"
                : "Describe the task…"
          }
          aria-label="Message"
          className="prompt-input"
          style={{ height: composerHeight, minHeight: MIN_COMPOSER_HEIGHT, maxHeight: "45vh" }}
        />
          <ComposerBar
            sessionId={session.id}
            session={session}
            running={running}
            turns={turns}
            started={started}
            panelRequest={panelRequest}
            onPanelConsumed={() => setPanelRequest(null)}
            actions={<>
              <button
                type="button"
                onClick={() => picker.current?.click()}
                aria-label="Attach pictures or files"
                title="Attach pictures or files — or paste or drop them here. Pictures go to the model; other files go in the chat's folder."
                className="prompt-action"
              >
                <LuPaperclip aria-hidden className="h-4 w-4" />
              </button>
              <DictationButton dictation={dictation} />
              <VoiceControl folder={session.workspace} canvasOpen={canvasOpen} onCanvasMinimize={()=>setCanvasOpen(false)} onCanvasToggle={()=>setCanvasOpen(value=>!value)} key={session.id} sessionId={session.id} items={items} running={running} onSend={onSend} onAbort={onAbort} stageTarget={voiceHost} onModeChange={setVoiceMode} title={session.title} browserAvailable={browserUp} browserActivity={latestBrowserActivity(events)} terminalActivity={latestTerminalActivity(events)} toolEvents={events} />
              {/* Mid-run, Stop stays while a message is written: it is the
                  moment the agent is seen going the wrong way, and whether to
                  steer it or stop it is still open. */}
              {running && <button type="button" aria-label="Stop generation" title="Stop generation (Esc)" onClick={() => void attempt(onAbort)} className="prompt-action prompt-stop">
                <LuSquare aria-hidden className="h-4 w-4" fill="currentColor" />
              </button>}
              {(!running || input.trim() || attached.length > 0) && <button type="submit" aria-label="Send message" title={running ? 'Send into the running task — it goes in after the current step' : 'Send message'} disabled={sending || adding > 0 || (!input.trim() && !attached.length)}
                className="prompt-action prompt-send">
                <LuArrowUp aria-hidden className="h-5 w-5" />
              </button>}
            </>}
          />
        </div>
      </form>
      </div>

      {/* Beside the conversation rather than above it: the page changing while
          the agent explains what it is doing is the thing worth seeing, and a
          strip across the top pushed the transcript out of view to show it. */}
      {asidePanels.length > 0 && (
        <>
          <div
            onPointerDown={dragWidth}
            title="Drag to resize"
            className="w-1 shrink-0 cursor-col-resize bg-line transition hover:bg-accent/40 max-md:hidden"
          />
          <aside
            ref={browserPane}
            style={{ width: asideWidth }}
            // On a phone there is no room beside the conversation: the panels
            // cover it, under the header that opened them, until closed.
            className="flex shrink-0 flex-col overflow-hidden border-l border-line [&:fullscreen]:w-screen max-md:absolute max-md:inset-0 max-md:z-20 max-md:!w-full max-md:border-l-0 max-md:bg-surface"
          >
            {asidePanels.map((kind, i) => (
              <Fragment key={kind}>
                {i > 0 && (
                  <div
                    onPointerDown={dragSplit}
                    title="Drag to resize"
                    className="h-1 shrink-0 cursor-row-resize bg-line transition hover:bg-accent/40"
                  />
                )}
                <div
                  className={`flex min-h-0 flex-col ${kind === "browser" ? "bg-black" : ""}`}
                  style={{ flex: asidePanels.length === 1 ? "1 1 0%" : `${i === 0 ? split : 1 - split} 1 0%` }}
                >
                  <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-1.5">
                    {kind === "terminal" ? (
                      <div className="chat-tabs" role="tablist" aria-label="Terminals">
                        <button type="button" role="tab" aria-selected={terminalTab === "agent"} onClick={() => setTerminalTab("agent")}>
                          Agent
                          {running && <i className="chat-tab-live" aria-label="Running" />}
                        </button>
                        <button type="button" role="tab" aria-selected={terminalTab === "shell"} onClick={() => setTerminalTab("shell")}>
                          Your shell
                        </button>
                      </div>
                    ) : (
                      <span className="text-[11px] text-fg-subtle">{kind === "browser" ? "Browser" : "Files"}</span>
                    )}
                    {kind === "terminal" && terminalTab === "shell" && <span className="max-md:hidden truncate font-mono text-[10px] text-fg-faint">{session.workspace}</span>}
                    {kind === "browser" && (
                      <button
                        onClick={() => browserPane.current?.requestFullscreen?.()}
                        className="ml-auto rounded px-1.5 py-0.5 text-[11px] text-fg-faint transition hover:text-fg"
                      >
                        Fullscreen
                      </button>
                    )}
                    <button
                      onClick={() => (kind === "browser" ? setWatching(false) : kind === "files" ? void closeFiles() : setTerminal(false))}
                      title="Collapse"
                      aria-label={`Close the ${kind === "browser" ? "browser" : kind === "files" ? "files" : "terminal"}`}
                      className={`${kind === "browser" ? "" : "ml-auto "}rounded px-1.5 py-0.5 text-[11px] text-fg-faint transition hover:text-fg`}
                    >
                      ✕
                    </button>
                  </div>
                  {kind === "browser" && (
                    <iframe
                      src="/browser-ui/"
                      title="The agent's browser"
                      className="min-h-0 flex-1 border-0"
                      allow="clipboard-read; clipboard-write; fullscreen"
                    />
                  )}
                  {kind === "files" && (
                    <div className="min-h-0 flex-1 bg-surface">
                      {/* Not before the chat's events are here: what it did earlier is not news. */}
                      {!loading && <FilesPanel key={session.id} sessionId={session.id} folder={session.workspace} activity={fileActivity} onDirtyChange={setFilesDirty} />}
                    </div>
                  )}
                  {kind === "terminal" && (
                    <div className="relative min-h-0 flex-1 bg-[#0b0b0d]">
                      <div className={terminalTab === "agent" ? "chat-terminal-pane" : "chat-terminal-pane is-hidden"}>
                        <VoiceTerminal events={events} limit={500} maxOutput={200_000} focus={terminalFocus} />
                      </div>
                      {shellStarted && (
                        <div className={terminalTab === "shell" ? "chat-terminal-pane" : "chat-terminal-pane is-hidden"}>
                          <TerminalPanel sessionId={session.id} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </Fragment>
            ))}
          </aside>
        </>
      )}
      </div>
    </div>
  );
}

/** What the agent said, as it is read — without the reasoning model's stray tags. */
const assistantText = (item: Extract<Item, { kind: "assistant" }>) =>
  (item.audio ? displaySpeechText(item.text, item.done) : item.text).replace(/<\/?think(ing)?>/gi, "");

/** Copies a message, and for a moment says that it did. */
function CopyAction({ text }: { text: string }) {
  const [result, setResult] = useState<"done" | "failed" | null>(null);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <MessageAction
      label={result === "done" ? "Copied" : result === "failed" ? "Could not copy" : "Copy"}
      onClick={async () => {
        setResult((await copyText(text)) ? "done" : "failed");
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setResult(null), 1500);
      }}
    >
      {result === "done" ? <LuCheck className="h-3 w-3 text-ok" /> : <LuCopy className="h-3 w-3" />}
    </MessageAction>
  );
}

function MessageAction({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`rounded p-1.5 text-fg-faint transition disabled:cursor-not-allowed disabled:opacity-40 ${
        danger ? "hover:text-danger" : "hover:text-accent"
      }`}
    >
      {children}
    </button>
  );
}

/** A sent message, opened for rewriting in place. */
function MessageEditor({
  initial,
  hasImages,
  onSave,
  onCancel,
}: {
  initial: string;
  /** The message went with pictures: they go again, so the words may be left out. */
  hasImages?: boolean;
  onSave: (text: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const changed = value.trim() !== initial.trim();
  const empty = !value.trim() && !hasImages;

  const save = async () => {
    if (empty || !changed || saving) return;
    setSaving(true);
    try {
      await onSave(value.trim());
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-full max-w-[80%] rounded-2xl bg-accent/10 p-2 ring-1 ring-inset ring-accent/30">
      <textarea
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (isEscape(e)) onCancel();
          if (isEnter(e) && !e.shiftKey) {
            e.preventDefault();
            save();
          }
        }}
        rows={Math.min(10, Math.max(2, value.split("\n").length))}
        aria-label="Edit message"
        className="w-full resize-none bg-transparent px-1.5 py-1 text-sm text-fg outline-none"
      />
      <div className="mt-1 flex items-center gap-2 px-1">
        <span className="text-[11px] text-fg-faint">
          Replaces this message and everything after it.{hasImages && " The pictures go with it again."}
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="ml-auto rounded-lg px-2.5 py-1 text-xs text-fg-muted transition hover:bg-fg/5"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving || !changed || empty}
          className="rounded-lg bg-accent/15 px-2.5 py-1 text-xs text-accent ring-1 ring-inset ring-accent/25 transition hover:bg-accent/25 disabled:opacity-40"
        >
          {saving ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
