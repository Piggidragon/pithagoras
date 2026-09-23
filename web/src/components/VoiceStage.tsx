import { ActivityProgress } from './ActivityProgress';
import type { Activity } from '../transcript';
import { useWorkPanels } from "../use-work-panels";
import { FilesPanel } from "./FilesPanel";
import { latestFileActivity, type FileActivity } from "../file-activity";
import { VoiceToolActivity } from "./VoiceToolActivity";
import { useEffect, useMemo, useRef, useState, type DragEvent, type MutableRefObject } from "react";
import { buildTranscript, type Item } from "../transcript";
import { LuMic, LuMicOff, LuX, LuGlobe, LuMaximize2, LuMinus, LuTerminal, LuFileText, LuFolderOpen, LuImage, LuImagePlus, LuRotateCcw, LuSquare, LuMessageSquareText, LuSlidersHorizontal } from "react-icons/lu";
import { VoicePictures, shownPictures } from "./VoicePictures";
import { VoiceConversation } from "./VoiceConversation";
import { VoiceSettings, VOICE_RATES } from "./VoiceSettings";
import { ACTIONS, describe, matches, useKeyLabels, useKeybindings, type ActionId } from "../keybindings";
import { placeWindows } from "../voice-windows";
import { ResizeHandles, clearSize } from "./ResizeHandles";
import { IMAGE_TYPES, isImage, type Attachment } from "../attachments";
import type { ToolCall } from "../tool-activity";
import { VoiceTerminal } from "./VoiceTerminal";
import { api, type PortalEvent } from "../api";
import type { VoiceCue } from "../voice-cues";
import type { VoicePhase } from "../hands-free";

export interface VoiceLevels { input: number; output: number }
type OrbMode = "input" | "output" | "idle" | "muted";

/** The shape follows real RMS audio levels; the slow drift only gives idle depth. */
function VoiceOrb({ mode, levels }: { mode: OrbMode; levels: MutableRefObject<VoiceLevels> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const current = useRef(mode); current.current = mode;
  useEffect(() => {
    const element = canvas.current!;
    const ctx = element.getContext("2d");
    if (!ctx) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const size = 600;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    element.width = size * ratio; element.height = size * ratio;
    ctx.scale(ratio, ratio);
    let frame = 0, level = 0;
    let color = [130, 188, 255];
    const colors = { input: [83, 247, 215], output: [190, 159, 255], idle: [130, 188, 255], muted: [161, 179, 204] };
    const render = (timestamp: number) => {
      const mode = current.current;
      const value = mode === "input" ? levels.current.input : mode === "output" ? levels.current.output : 0;
      level += (value - level) * (value > level ? 0.3 : 0.09);
      color = color.map((v, i) => v + (colors[mode][i] - v) * 0.06);
      const rgb = color.map(Math.round).join(",");
      const t = reduced ? 0 : timestamp * 0.00055;
      const r = 132 + level * (reduced ? 5 : 28);
      ctx.clearRect(0, 0, size, size);
      ctx.save(); ctx.translate(size / 2, size / 2);
      const halo = ctx.createRadialGradient(0, 0, r * 0.65, 0, 0, r * 1.7);
      halo.addColorStop(0, `rgba(${rgb},${0.3 + level * 0.18})`); halo.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = halo; ctx.fillRect(-size / 2, -size / 2, size, size);
      for (let ring = 0; ring < 2; ring++) {
        ctx.beginPath();
        ctx.ellipse(0, 0, r + 20 + ring * 16 + level * 7, r + 18 + ring * 16, Math.sin(t) * 0.12, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${rgb},${0.2 + level * 0.15 - ring * 0.05})`; ctx.lineWidth = 1.2; ctx.stroke();
      }
      ctx.beginPath();
      for (let i = 0; i <= 160; i++) {
        const a = i / 160 * Math.PI * 2;
        const wave = Math.sin(a * 3 + t * 1.3) * (3 + level * 7) + Math.sin(a * 5 - t * 2) * level * 10;
        const x = Math.cos(a) * (r + wave), y = Math.sin(a) * (r + wave);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      const sphere = ctx.createRadialGradient(-r * 0.32, -r * 0.45, 1, r * 0.12, r * 0.1, r * 1.32);
      sphere.addColorStop(0, `rgba(${rgb},0.98)`); sphere.addColorStop(0.32, `rgba(${rgb},0.95)`);
      sphere.addColorStop(0.7, `rgb(${color.map(v => Math.round(v * 0.62)).join(",")})`); sphere.addColorStop(1, `rgb(${color.map(v => Math.round(v * 0.34)).join(",")})`);
      ctx.shadowColor = `rgba(${rgb},0.65)`; ctx.shadowBlur = 22;
      ctx.fillStyle = sphere; ctx.fill(); ctx.shadowBlur = 0;
      ctx.strokeStyle = `rgba(${rgb},0.8)`; ctx.lineWidth = 1.8; ctx.stroke(); ctx.save(); ctx.clip();
      // Translucent ribbons bend across the sphere rather than flat sine bars.
      for (let band = 0; band < 15; band++) {
        const y = -r + band * r * 0.15;
        const bend = Math.sin(t + band * 0.27) * 35 + level * 22;
        ctx.beginPath(); ctx.moveTo(-r * 1.3, y);
        ctx.bezierCurveTo(-r * 0.45, y - 60 + bend, r * 0.35, y + 65 + bend, r * 1.3, y - 20);
        ctx.bezierCurveTo(r * 0.3, y + 85 + bend, -r * 0.4, y - 40 + bend, -r * 1.3, y + 9);
        const ribbon = ctx.createLinearGradient(-r, -r, r, r);
        ribbon.addColorStop(0, `rgba(231,255,255,${0.04 + band * 0.003})`);
        ribbon.addColorStop(0.45, `rgba(${rgb},${0.24 + level * 0.12})`);
        ribbon.addColorStop(1, "rgba(192,190,255,0.03)");
        ctx.fillStyle = ribbon; ctx.fill();
      }
      const shine = ctx.createRadialGradient(-r * 0.33, -r * 0.55, 0, -r * 0.33, -r * 0.55, r * 0.85);
      shine.addColorStop(0, "rgba(238,255,255,0.45)"); shine.addColorStop(0.35, "rgba(233,253,255,0.08)"); shine.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = shine; ctx.fillRect(-r, -r, 2 * r, 2 * r);
      ctx.restore(); ctx.restore();
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [levels]);
  return <canvas ref={canvas} aria-hidden="true" className="voice-orb" data-mode={mode} />;
}

/** Where focus is typing, so Space and a paste belong to that and not to voice mode. */
const editing = (target: EventTarget | null) => !!(target as Element | null)?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');

export function VoiceStage({ sessionId, folder, workPhase, canvasOpen, onCanvasMinimize, onCanvasToggle, title, phase, starting, muted, speaking, levels, error, transcript, onMute, onEnd, browserAvailable, browserActivity, terminalActivity, toolEvents, sounds, onSounds, onCue,
  waitingForTap, items, running, onStop, attachments, onAddPictures, onRemovePicture, canRepeat, onRepeat, rate, onRate, steer, onSteer, ptt, onPtt, holding, onHold }: {
  sessionId: string; folder: string;
  workPhase?: Activity | null;
  canvasOpen: boolean; onCanvasMinimize: () => void; onCanvasToggle: () => void;
  title: string; phase: VoicePhase; starting: boolean; muted: boolean; speaking: boolean;
  levels: MutableRefObject<VoiceLevels>; transcript: string; error: string; onMute: () => void; onEnd: () => void;
  browserAvailable: boolean; browserActivity: number; terminalActivity: number; toolEvents: PortalEvent[]; sounds: boolean; onSounds: () => void; onCue: (kind: VoiceCue) => void;
  /** Back after a reload, and waiting for a tap before audio may start. */
  waitingForTap?: boolean;
  items: Item[]; running: boolean; onStop: () => void;
  /** Pictures waiting to go with the next thing said. */
  attachments: Attachment[]; onAddPictures: (files: File[]) => void; onRemovePicture: (id: string) => void;
  canRepeat: boolean; onRepeat: () => void;
  rate: number; onRate: (rate: number) => void;
  steer: boolean; onSteer: (steer: boolean) => void;
  ptt: boolean; onPtt: (ptt: boolean) => void; holding: boolean; onHold: (down: boolean) => void;
}) {
  const end = useRef<HTMLButtonElement>(null), browser = useRef<HTMLElement>(null);
  const activity = useRef(browserActivity), terminalSeen = useRef(terminalActivity);
  const terminal = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false), [terminalShown, setTerminalShown] = useState(false);
  const [filesShown, setFilesShown] = useState(false), [filesUsed, setFilesUsed] = useState(false), [filesSince, setFilesSince] = useState<number | undefined>(undefined);
  const filesWindow = useRef<HTMLElement>(null), picturesWindow = useRef<HTMLElement>(null), conversationWindow = useRef<HTMLElement>(null);
  // Pictures the agent showed with show_image. A new one opens the window on it.
  const pictures = useMemo(() => shownPictures(toolEvents), [toolEvents]);
  const picturesSeen = useRef(pictures.at(-1)?.seq ?? 0);
  const [picturesShown, setPicturesShown] = useState(false), [pictureIndex, setPictureIndex] = useState(0);
  const [conversation, setConversation] = useState(false), [settings, setSettings] = useState(false);
  const settingsToggle = useRef<HTMLButtonElement>(null);
  const [dropping, setDropping] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  useWorkPanels({ browser: shown, terminal: terminalShown, canvas: canvasOpen, files: filesShown, pictures: picturesShown, conversation }, panel => {
    if (panel === "browser") setShown(false); else if (panel === "terminal") setTerminalShown(false); else if (panel === "files") setFilesShown(false); else if (panel === "pictures") setPicturesShown(false); else if (panel === "conversation") setConversation(false); else onCanvasMinimize();
  });
  // What the agent reads or changes in the chat's folder. Files opens on it as
  // the browser and terminal do, and follows it from there. A file opened from
  // a tool card is put after everything that has happened, so that the panel
  // takes it, and the agent's next file after that again.
  const agentFile = useMemo(() => latestFileActivity(toolEvents, folder), [toolEvents, folder]);
  const [openedFile, setOpenedFile] = useState<FileActivity | null>(null);
  const fileActivity = openedFile && openedFile.seq > (agentFile?.seq ?? 0) ? openedFile : agentFile;
  const filesSeen = useRef(agentFile?.seq ?? 0);
  // Where the windows go: the browser in the middle, the terminal at the side,
  // and Files and pictures wherever is left (see voice-windows.ts). The stage's
  // classes say whether there is a window in the middle and one at the side,
  // for where the orb goes; which window is open is the window's own `is-open`.
  const place = placeWindows({ browser: shown, terminal: terminalShown, files: filesShown, pictures: picturesShown, conversation });
  const filesMain = place.main === "files", picturesMain = place.main === "pictures", conversationMain = place.main === "conversation";
  const browsing = !!place.main;
  const sideWindow = !!place.side;
  const [loaded, setLoaded] = useState(false);
  const [terminalUsed, setTerminalUsed] = useState(false);
  const [browserError, setBrowserError] = useState('');
  const thoughtViewport = useRef<HTMLDivElement>(null);
  const thought = useMemo(() => {
    const latest = buildTranscript(toolEvents).at(-1);
    return latest?.kind === 'assistant' && !latest.done && !latest.text ? latest.thinking : '';
  }, [toolEvents]);
  useEffect(() => {
    const el = thoughtViewport.current;
    if (!el) return;
    const follow = () => { el.scrollTop = el.scrollHeight; };
    follow();
    const observer = new ResizeObserver(follow);
    observer.observe(el);
    return () => observer.disconnect();
  }, [thought, shown, terminalShown, filesShown, picturesShown, conversation]);
  useEffect(() => { end.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    if (browser.current) browser.current.inert = !shown;
    if (terminal.current) terminal.current.inert = !terminalShown;
    if (filesWindow.current) filesWindow.current.inert = !filesShown;
    if (picturesWindow.current) picturesWindow.current.inert = !picturesShown;
    if (conversationWindow.current) conversationWindow.current.inert = !conversation;
  }, [shown, terminalShown, filesShown, picturesShown, conversation]);
  useEffect(() => {
    if (!agentFile || agentFile.seq <= filesSeen.current) return;
    filesSeen.current = agentFile.seq;
    // The first time, the panel starts from just before this, so it shows it.
    if (!filesUsed) { setFilesSince(agentFile.seq - 1); setFilesUsed(true); }
    setFilesShown(true); onCue("focus");
  }, [agentFile?.seq, filesUsed, onCue]);
  useEffect(() => {
    const last = pictures.at(-1);
    if (!last || last.seq <= picturesSeen.current) return;
    picturesSeen.current = last.seq;
    setPictureIndex(pictures.length - 1); setPicturesShown(true); onCue("focus");
  }, [pictures, onCue]);
  const openPictures = () => { setPictureIndex(Math.max(0, pictures.length - 1)); setPicturesShown(true); onCue("focus"); };
  /** A tool card was tapped: bring up what it was about. */
  const openCall = (call: ToolCall) => {
    if (call.target === "files" && call.path) {
      const seq = Math.max(fileActivity?.seq ?? 0, ...toolEvents.map(e => e.seq)) + 0.5;
      if (!filesUsed) { setFilesSince(seq - 1); setFilesUsed(true); }
      setOpenedFile({ seq, path: call.path, tool: "read" }); setFilesShown(true); onCue("focus");
    } else if (call.target === "terminal") { setTerminalUsed(true); setTerminalShown(true); onCue("focus"); }
    else if (call.target === "browser") open();
    else if (call.target === "canvas") { if (!canvasOpen) onCanvasToggle(); }
    else if (call.target === "pictures") openPictures();
  };
  // Pictures pasted anywhere on the stage go with the next thing said; a paste
  // into something being typed in is that field's.
  const add = useRef(onAddPictures); add.current = onAddPictures;
  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      if (editing(e.target)) return;
      const files = [...(e.clipboardData?.files ?? [])].filter(f => isImage(f.type));
      if (!files.length) return;
      e.preventDefault(); add.current(files);
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  }, []);
  // Keyboard shortcuts (see keybindings.ts). Each action says whether it did
  // anything: one that did not — Stop with nothing running — leaves the key to
  // whatever else wants it. Starting and ending voice mode is VoiceControl's.
  const bindings = useKeybindings(), layout = useKeyLabels();
  const hint = (id: ActionId) => bindings[id] ? ` (${describe(bindings[id], layout)})` : "";
  const step = (by: number) => {
    const at = VOICE_RATES.indexOf(rate), next = VOICE_RATES[Math.min(VOICE_RATES.length - 1, Math.max(0, (at < 0 ? 0 : at) + by))];
    if (next === rate) return false;
    onRate(next); return true;
  };
  const actions: Partial<Record<ActionId, () => boolean | void>> = {
    "voice.mute": () => { if (ptt || starting) return false; onMute(); },
    // Stops the agent while it works; with nothing running, ends voice mode.
    "voice.stop": () => { if (running) onStop(); else onEnd(); },
    "voice.picture": () => { picker.current?.click(); },
    "voice.repeat": () => { if (!canRepeat || speaking) return false; onRepeat(); },
    "voice.conversation": () => { if (!conversation) onCue("focus"); setConversation(v => !v); },
    "voice.canvas": () => { onCanvasToggle(); },
    "voice.files": () => { if (filesShown) setFilesShown(false); else openFiles(); },
    "voice.pictures": () => { if (picturesShown) setPicturesShown(false); else if (pictures.length) openPictures(); else return false; },
    "voice.terminal": () => { if (terminalShown) setTerminalShown(false); else { setTerminalUsed(true); setTerminalShown(true); onCue("focus"); } },
    "voice.browser": () => { if (shown) minimize(); else if (browserAvailable || loaded) open(); else return false; },
    "voice.settings": () => { setSettings(v => !v); },
    "voice.faster": () => step(1),
    "voice.slower": () => step(-1),
    "voice.steer": () => { onSteer(!steer); },
    "voice.ptt": () => { onPtt(!ptt); },
    "voice.sounds": () => { onSounds(); },
  };
  const keys = useRef({ bindings, actions, ptt, onHold }); keys.current = { bindings, actions, ptt, onHold };
  useEffect(() => {
    // In the capture phase, before a focused button: holding Space for
    // push-to-talk would otherwise also press whatever button has focus.
    const down = (e: KeyboardEvent) => {
      const { bindings, actions, ptt, onHold } = keys.current;
      // A dialog, or the voice settings card closing on Escape, has the key.
      if (e.defaultPrevented || document.querySelector('[aria-modal="true"]')) return;
      if (e.code === "Escape" && document.querySelector(".voice-settings")) return;
      const typing = editing(e.target);
      if (ptt && matches(bindings["voice.hold"], e) && !(typing && !e.ctrlKey && !e.altKey && !e.metaKey)) {
        e.preventDefault(); e.stopPropagation();
        if (!e.repeat) onHold(true);
        return;
      }
      for (const action of ACTIONS) {
        const act = actions[action.id];
        if (!act || !matches(bindings[action.id], e)) continue;
        const b = bindings[action.id]!;
        if (typing && !(b.ctrl || b.alt || b.meta)) return;
        if (e.repeat) { e.preventDefault(); return; }
        if (act() !== false) { e.preventDefault(); e.stopPropagation(); }
        return;
      }
    };
    const up = (e: KeyboardEvent) => {
      const { bindings, ptt, onHold } = keys.current;
      if (!ptt || !matches(bindings["voice.hold"], e)) return;
      e.preventDefault(); e.stopPropagation(); onHold(false);
    };
    const away = () => { if (keys.current.ptt) keys.current.onHold(false); };
    window.addEventListener("keydown", down, true); window.addEventListener("keyup", up, true); window.addEventListener("blur", away);
    return () => { window.removeEventListener("keydown", down, true); window.removeEventListener("keyup", up, true); window.removeEventListener("blur", away); };
  }, []);
  const openFiles = () => {
    setFilesUsed(true); setFilesShown(true); onCue("focus");
  };
  useEffect(() => {
    if (terminalActivity <= terminalSeen.current) return;
    terminalSeen.current = terminalActivity; setTerminalUsed(true);
    setTerminalShown(true); onCue("focus");
  }, [terminalActivity, onCue]);
  useEffect(() => {
    if (browserActivity <= activity.current) return;
    activity.current = browserActivity;
    let cancelled = false;
    void api.browser().then(status => {
      if (cancelled) return;
      if (status.install.container !== 'running') { setBrowserError('The browser viewer is unavailable.'); return; }
      setBrowserError(''); setLoaded(true); setShown(true); onCue('focus');
    }).catch(() => { if (!cancelled) setBrowserError('Could not connect to the browser viewer.'); });
    return () => { cancelled = true; };
  }, [browserActivity, onCue]);
  const open = () => { setLoaded(true); setShown(true); onCue('focus'); };
  const minimize = () => { setShown(false); end.current?.focus({ preventScroll: true }); };
  const input = !muted && phase === "Hearing you";
  const mode: OrbMode = input ? "input" : speaking ? "output" : muted ? "muted" : "idle";
  const touch = typeof matchMedia === "function" && matchMedia("(hover: none)").matches;
  const status = waitingForTap ? (touch ? "Tap to continue voice mode" : "Click or press a key to continue voice mode") : starting ? "Connecting" : input || holding ? "Hearing you" : speaking ? "Speaking" : phase === "Speaking" ? "Preparing your reply" : phase === "Thinking" ? "Thinking" : phase === "Transcribing" ? "Transcribing" : muted ? "Microphone muted" : ptt ? (touch || !bindings["voice.hold"] ? "Hold the microphone to talk" : `Hold ${describe(bindings["voice.hold"], layout)} to talk`) : "Listening";
  const anyPanel = shown || terminalShown || filesShown || picturesShown || conversation;
  // A window sized by hand keeps its size until the windows are arranged
  // differently — one opens or closes — and then the layout places it again.
  const arrangement = `${place.main}|${place.side}|${canvasOpen}`;
  useEffect(() => {
    for (const el of [browser.current, terminal.current, filesWindow.current, picturesWindow.current, conversationWindow.current]) clearSize(el);
  }, [arrangement]);
  const drop = (e: DragEvent) => {
    if (e.defaultPrevented || !e.dataTransfer.types.includes("Files")) return;
    e.preventDefault(); setDropping(false);
    add.current([...e.dataTransfer.files]);
  };
  return <section className={`voice-stage ${browsing ? 'is-browsing' : ''} ${sideWindow ? 'is-terminal' : ''} ${dropping ? 'is-dropping' : ''}`} aria-label="Voice conversation" data-panels={Number(shown) + Number(terminalShown) + Number(filesShown) + Number(picturesShown) + Number(conversation) + Number(canvasOpen)} data-mode={mode}
    onDragOver={e => { if (e.defaultPrevented || !e.dataTransfer.types.includes("Files")) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setDropping(true); }}
    onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false); }}
    onDrop={drop}>
    <header className="voice-stage-header">
      <span className="voice-stage-session">{title}</span>
      <div className="voice-utilities">
        {!conversation && <button type="button" onClick={() => { setConversation(true); onCue("focus"); }} title={`Conversation${hint("voice.conversation")}`} aria-label="Show the conversation"><LuMessageSquareText /></button>}
        <button type="button" onClick={onCanvasToggle} title={`Session canvases${hint("voice.canvas")}`} aria-label="Session canvases" aria-expanded={canvasOpen}><LuFileText /></button>
        {!filesShown && <button type="button" onClick={openFiles} title={`Show files${hint("voice.files")}`} aria-label="Show files"><LuFolderOpen /></button>}
        {pictures.length > 0 && !picturesShown && <button type="button" onClick={openPictures} title={`Show pictures${hint("voice.pictures")}`} aria-label="Show pictures"><LuImage /></button>}
        {(browserAvailable || loaded) && !shown && <button type="button" onClick={open} title={`Show browser${hint("voice.browser")}`} aria-label="Show browser"><LuGlobe /></button>}
        {!terminalShown && <button type="button" aria-label="Show terminal" title={`Show terminal${hint("voice.terminal")}`} onClick={() => { setTerminalUsed(true); setTerminalShown(true); onCue("focus"); }}><LuTerminal /></button>}
        <button ref={settingsToggle} type="button" data-voice-settings-toggle onClick={() => setSettings(v => !v)} title={`Voice settings${hint("voice.settings")}`} aria-label="Voice settings" aria-expanded={settings}><LuSlidersHorizontal /></button>
      </div>
      {settings && <VoiceSettings anchor={settingsToggle} sounds={sounds} onSounds={onSounds} rate={rate} onRate={onRate} steer={steer} onSteer={onSteer} ptt={ptt} onPtt={onPtt} onClose={() => setSettings(false)} />}
    </header>
    {attachments.length > 0 && <div className="voice-attachments" aria-label="Pictures for your next message">
      <div>{attachments.map(a => <figure key={a.id}>
        <img src={a.data} alt={a.name} />
        <button type="button" aria-label={`Remove ${a.name}`} title="Remove" onClick={() => onRemovePicture(a.id)}><LuX /></button>
      </figure>)}</div>
      <span>Sent with what you say next</span>
    </div>}
    {dropping && <div className="voice-drop-hint" aria-hidden="true"><LuImagePlus />Drop pictures to send them with what you say next</div>}
    <input ref={picker} type="file" accept={IMAGE_TYPES.join(",")} multiple hidden onChange={e => { const files = [...(e.target.files ?? [])]; e.target.value = ""; if (files.length) onAddPictures(files); }} />
    <section ref={browser} className={`voice-browser-window ${shown ? 'is-open' : ''}`} aria-label="Live browser" aria-hidden={!shown}>
      <header><span><i />Live browser</span><div>
        <button type="button" aria-label="Fullscreen browser" title="Fullscreen" onClick={() => { void browser.current?.requestFullscreen?.().catch(() => setBrowserError('Fullscreen is unavailable.')); }}><LuMaximize2 /></button>
        <button type="button" aria-label="Minimize browser" title="Minimize browser" onClick={minimize}><LuMinus /></button>
      </div></header>
      {loaded && <iframe src="/browser-ui/" title="The agent's browser" allow="clipboard-read; clipboard-write; fullscreen" />}
      <ResizeHandles target={browser} />
    </section>
    <section ref={terminal} className={`voice-terminal-window ${terminalShown ? 'is-open' : ''}`} aria-label="Live terminal" aria-hidden={!terminalShown}>
      <header><span><LuTerminal />Terminal</span><div><button type="button" aria-label="Minimize terminal" title="Minimize terminal" onClick={() => { setTerminalShown(false); end.current?.focus({ preventScroll: true }); }}><LuMinus /></button></div></header>
      {terminalUsed && <VoiceTerminal events={toolEvents} />}
      <ResizeHandles target={terminal} />
    </section>
    <section ref={filesWindow} className={`voice-files-window ${filesMain ? 'as-main' : 'as-side'} ${filesShown ? 'is-open' : ''}`} aria-label="Files" aria-hidden={!filesShown}>
      <header><span><LuFolderOpen />Files</span><div><button type="button" aria-label="Minimize files" title="Minimize files" onClick={() => { setFilesShown(false); end.current?.focus({ preventScroll: true }); }}><LuMinus /></button></div></header>
      {filesUsed && <FilesPanel sessionId={sessionId} folder={folder} activity={fileActivity} since={filesSince} />}
      <ResizeHandles target={filesWindow} />
    </section>
    <section ref={picturesWindow} className={`voice-files-window voice-pictures-window ${picturesMain ? 'as-main' : 'as-side'} ${picturesShown ? 'is-open' : ''}`} aria-label="Pictures" aria-hidden={!picturesShown}>
      <header><span><LuImage />Pictures</span><div><button type="button" aria-label="Minimize pictures" title="Minimize pictures" onClick={() => { setPicturesShown(false); end.current?.focus({ preventScroll: true }); }}><LuMinus /></button></div></header>
      {picturesShown && <VoicePictures sessionId={sessionId} pictures={pictures} index={Math.min(pictureIndex, pictures.length - 1)} onIndex={setPictureIndex} />}
      <ResizeHandles target={picturesWindow} />
    </section>
    <section ref={conversationWindow} className={`voice-files-window voice-conversation-window ${conversationMain ? 'as-main' : 'as-side'} ${conversation ? 'is-open' : ''}`} aria-label="Conversation" aria-hidden={!conversation}>
      <header><span><LuMessageSquareText />Conversation</span><div><button type="button" aria-label="Close the conversation" title="Close" onClick={() => { setConversation(false); end.current?.focus({ preventScroll: true }); }}><LuMinus /></button></div></header>
      {conversation && <VoiceConversation sessionId={sessionId} items={items} />}
      <ResizeHandles target={conversationWindow} />
    </section>
    <VoiceToolActivity events={toolEvents} folder={folder} onOpen={openCall} />
    <div className="voice-presence">
      <div className="voice-avatar"><VoiceOrb mode={mode} levels={levels} /></div>
      <div className="voice-dock-center">
        {workPhase && ['processing the prompt','compacting the conversation'].includes(workPhase.label) ? <ActivityProgress phase={workPhase} compact /> : <>
        <div className="voice-status" role="status"><span />{phase === 'Compacting context' ? phase : thought && anyPanel ? 'Thinking' : status}</div>
        {anyPanel && thought && phase !== 'Compacting context' && <div ref={thoughtViewport} className="voice-thought-stream" aria-label="Live model thinking">{thought.slice(-1200)}</div>}
        </>}
      </div>
      {!anyPanel && transcript && (input || holding || phase === "Transcribing") && <p className="voice-live-transcript" aria-label="Live transcription">{transcript}</p>}

      <div className="voice-stage-controls">
        {ptt
          ? <button type="button" className={`voice-stage-action voice-hold ${holding ? "is-holding" : ""}`} title={`Hold to talk${touch ? "" : hint("voice.hold")}`} aria-label="Hold to talk" aria-pressed={holding} disabled={starting}
              onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); onHold(true); }}
              onPointerUp={() => onHold(false)} onPointerCancel={() => onHold(false)} onContextMenu={e => e.preventDefault()}><LuMic /></button>
          : <button type="button" className={`voice-stage-action ${muted ? "is-muted" : ""}`} title={`${muted ? 'Unmute' : 'Mute'} microphone${hint('voice.mute')}`} aria-label={muted ? "Unmute microphone" : "Mute microphone"} aria-pressed={muted} disabled={starting} onClick={onMute}><LuMicOff className={muted ? '' : 'hidden'} /><LuMic className={muted ? 'hidden' : ''} /></button>}
        <button type="button" className={`voice-stage-action ${attachments.length ? "has-pictures" : ""}`} title={`Add a picture${hint("voice.picture")}`} aria-label="Add a picture" disabled={starting} onClick={() => picker.current?.click()}><LuImagePlus />{attachments.length > 0 && <i>{attachments.length}</i>}</button>
        <button type="button" className="voice-stage-action" title={`Repeat the last reply${hint("voice.repeat")}`} aria-label="Repeat the last reply" disabled={starting || !canRepeat || speaking} onClick={onRepeat}><LuRotateCcw /></button>
        {running && <button type="button" className="voice-stage-action voice-stop" title={`Stop what the agent is doing${hint("voice.stop")}`} aria-label="Stop the agent" onClick={onStop}><LuSquare /></button>}
        <button ref={end} type="button" className="voice-stage-action voice-end" title={`End voice mode${hint("voice.toggle")}${running || !bindings["voice.stop"] ? "" : ` or ${describe(bindings["voice.stop"], layout)}`}`} aria-label="End voice mode" onClick={onEnd}><LuX /></button>
      </div>
    </div>
    {(error || browserError) && <p role="alert" className="voice-stage-error">{error || browserError}</p>}
  </section>;
}
