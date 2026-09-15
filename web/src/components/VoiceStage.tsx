import { ActivityProgress } from './ActivityProgress';
import type { Activity } from '../transcript';
import { useWorkPanels } from "../use-work-panels";
import { VoiceToolActivity } from "./VoiceToolActivity";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { buildTranscript } from "../transcript";
import { LuMic, LuMicOff, LuX, LuGlobe, LuMaximize2, LuMinus, LuVolume2, LuVolumeX, LuTerminal, LuFileText } from "react-icons/lu";
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

export function VoiceStage({ workPhase, canvasOpen, onCanvasMinimize, onCanvasToggle, title, phase, starting, muted, speaking, levels, error, transcript, onMute, onEnd, browserAvailable, browserActivity, terminalActivity, toolEvents, sounds, onSounds, onCue }: {
  workPhase?: Activity | null;
  canvasOpen: boolean; onCanvasMinimize: () => void; onCanvasToggle: () => void;
  title: string; phase: VoicePhase; starting: boolean; muted: boolean; speaking: boolean;
  levels: MutableRefObject<VoiceLevels>; transcript: string; error: string; onMute: () => void; onEnd: () => void;
  browserAvailable: boolean; browserActivity: number; terminalActivity: number; toolEvents: PortalEvent[]; sounds: boolean; onSounds: () => void; onCue: (kind: VoiceCue) => void;
}) {
  const end = useRef<HTMLButtonElement>(null), browser = useRef<HTMLElement>(null);
  const activity = useRef(browserActivity), terminalSeen = useRef(terminalActivity);
  const terminal = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false), [terminalShown, setTerminalShown] = useState(false);
  useWorkPanels(shown, terminalShown, canvasOpen, panel => { if(panel === "browser") setShown(false); else if(panel === "terminal") setTerminalShown(false); else onCanvasMinimize(); });
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
  }, [thought, shown, terminalShown]);
  useEffect(() => { end.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    if (browser.current) browser.current.inert = !shown;
    if (terminal.current) terminal.current.inert = !terminalShown;
  }, [shown, terminalShown]);
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
  const status = starting ? "Connecting" : input ? "Hearing you" : speaking ? "Speaking" : phase === "Speaking" ? "Preparing your reply" : phase === "Thinking" ? "Thinking" : phase === "Transcribing" ? "Transcribing" : muted ? "Microphone muted" : "Listening";
  return <section className={`voice-stage ${shown ? 'is-browsing' : ''} ${terminalShown ? 'is-terminal' : ''}`} aria-label="Voice conversation" data-panels={Number(shown) + Number(terminalShown) + Number(canvasOpen)} data-mode={mode}>
    <header className="voice-stage-header">
      <span className="voice-stage-session">{title}</span>
      <div className="voice-utilities">
        <button type="button" onClick={onCanvasToggle} title="Session canvases" aria-label="Session canvases" aria-expanded={canvasOpen}><LuFileText /></button>
        {(browserAvailable || loaded) && !shown && <button type="button" onClick={open} title="Show browser" aria-label="Show browser"><LuGlobe /></button>}
        {terminalUsed && !terminalShown && <button type="button" aria-label="Show terminal" title="Show terminal" onClick={() => { setTerminalShown(true); onCue("focus"); }}><LuTerminal /></button>}
        <button type="button" onClick={onSounds} title={sounds ? 'Mute sound effects' : 'Enable sound effects'} aria-label={sounds ? 'Mute sound effects' : 'Enable sound effects'} aria-pressed={sounds}>{sounds ? <LuVolume2 /> : <LuVolumeX />}</button>

      </div>
    </header>
    <section ref={browser} className="voice-browser-window" aria-label="Live browser" aria-hidden={!shown}>
      <header><span><i />Live browser</span><div>
        <button type="button" aria-label="Fullscreen browser" title="Fullscreen" onClick={() => { void browser.current?.requestFullscreen?.().catch(() => setBrowserError('Fullscreen is unavailable.')); }}><LuMaximize2 /></button>
        <button type="button" aria-label="Minimize browser" title="Minimize browser" onClick={minimize}><LuMinus /></button>
      </div></header>
      {loaded && <iframe src="/browser-ui/" title="The agent's browser" allow="clipboard-read; clipboard-write; fullscreen" />}
    </section>
    <section ref={terminal} className="voice-terminal-window" aria-label="Live terminal" aria-hidden={!terminalShown}>
      <header><span><LuTerminal />Terminal</span><div><button type="button" aria-label="Minimize terminal" title="Minimize terminal" onClick={() => { setTerminalShown(false); end.current?.focus({ preventScroll: true }); }}><LuMinus /></button></div></header>
      {terminalUsed && <VoiceTerminal events={toolEvents} />}
    </section>
    <VoiceToolActivity events={toolEvents} />
    <div className="voice-presence">
      <div className="voice-avatar"><VoiceOrb mode={mode} levels={levels} /></div>
      <div className="voice-dock-center">
        {workPhase && ['processing the prompt','compacting the conversation'].includes(workPhase.label) ? <ActivityProgress phase={workPhase} compact /> : <>
        <div className="voice-status" role="status"><span />{phase === 'Compacting context' ? phase : thought && (shown || terminalShown) ? 'Thinking' : status}</div>
        {(shown || terminalShown) && thought && phase !== 'Compacting context' && <div ref={thoughtViewport} className="voice-thought-stream" aria-label="Live model thinking">{thought.slice(-1200)}</div>}
        </>}
      </div>
      {!shown && !terminalShown && transcript && (input || phase === "Transcribing") && <p className="voice-live-transcript" aria-label="Live transcription">{transcript}</p>}

      <div className="voice-stage-controls">
        <button type="button" className={`voice-stage-action ${muted ? "is-muted" : ""}`} title={muted ? 'Unmute microphone' : 'Mute microphone'} aria-label={muted ? "Unmute microphone" : "Mute microphone"} aria-pressed={muted} disabled={starting} onClick={onMute}><LuMicOff className={muted ? '' : 'hidden'} /><LuMic className={muted ? 'hidden' : ''} /></button>
        <button ref={end} type="button" className="voice-stage-action voice-end" title="End voice mode" aria-label="End voice mode" onClick={onEnd}><LuX /></button>
      </div>
    </div>
    {(error || browserError) && <p role="alert" className="voice-stage-error">{error || browserError}</p>}
  </section>;
}
