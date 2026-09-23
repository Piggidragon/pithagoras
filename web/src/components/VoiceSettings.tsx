import { Fragment, useEffect, useRef } from "react";

/** The speeds offered. Faster than 1.75× stops being speech anyone follows. */
export const VOICE_RATES = [1, 1.25, 1.5, 1.75];

/**
 * How voice mode behaves, in a small card by its buttons: sound effects, how
 * fast the agent speaks, what talking mid-run does, and push-to-talk. Each is
 * remembered in this browser.
 */
export function VoiceSettings({ sounds, onSounds, rate, onRate, steer, onSteer, ptt, onPtt, onClose }: {
  sounds: boolean; onSounds: () => void;
  rate: number; onRate: (rate: number) => void;
  steer: boolean; onSteer: (steer: boolean) => void;
  ptt: boolean; onPtt: (ptt: boolean) => void;
  onClose: () => void;
}) {
  const card = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (card.current?.contains(target) || target?.closest?.('[data-voice-settings-toggle]')) return;
      close.current();
    };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close.current(); } };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape, true);
    return () => { window.removeEventListener("pointerdown", outside); window.removeEventListener("keydown", escape, true); };
  }, []);
  const choice = <T,>(value: T, current: T, label: string, pick: (value: T) => void) =>
    <button type="button" aria-pressed={value === current} onClick={() => pick(value)}>{label}</button>;
  return <div ref={card} className="voice-settings" role="dialog" aria-label="Voice settings">
    <div className="voice-setting" role="group" aria-label="Speaking speed">
      <span aria-hidden="true">Speaking speed</span>
      <div className="voice-segments">{VOICE_RATES.map(r => <Fragment key={r}>{choice(r, rate, `${r}×`, onRate)}</Fragment>)}</div>
    </div>
    <div className="voice-setting" role="group" aria-label="Talking while the agent works">
      <span aria-hidden="true">Talking while the agent works</span>
      <div className="voice-segments">
        {choice(false, steer, "Stops it", onSteer)}
        {choice(true, steer, "Adds to the task", onSteer)}
      </div>
      <p>{steer ? "What you say goes into the running task after its current step. The stop button still stops it." : "What you say stops the task and starts a new turn."}</p>
    </div>
    <div className="voice-setting" role="group" aria-label="Push to talk">
      <span aria-hidden="true">Push to talk</span>
      <div className="voice-segments">
        {choice(false, ptt, "Off", onPtt)}
        {choice(true, ptt, "On", onPtt)}
      </div>
      <p>{ptt ? "Only heard while you hold Space or the microphone button." : "Heard whenever you speak."}</p>
    </div>
    <div className="voice-setting" role="group" aria-label="Sound effects">
      <span aria-hidden="true">Sound effects</span>
      <div className="voice-segments">
        {choice(false, sounds, "Off", () => sounds && onSounds())}
        {choice(true, sounds, "On", () => !sounds && onSounds())}
      </div>
    </div>
  </div>;
}
