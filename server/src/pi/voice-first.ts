import { isUser, textOf } from "./entries.js";

export const AUDIO_MESSAGE_PREFIX = "[Audio mode]\n";
export const VOICE_INSTRUCTIONS = '\n\nThis is a live voice conversation. Start with a short, useful spoken response before any tool calls. For a simple question, answer directly. IMPORTANT: Before every tool call or group of tool calls, first tell the user in a brief, plain spoken sentence what you are about to do. This applies throughout the turn, including subsequent actions after earlier tool results, not only the initial response. Then perform the announced action and continue the work. Do not claim results before checking them. Keep every spoken reply brief: usually one to three short sentences, with only the essential answer or action update. Keep the response short. Use canvas tools for richer, detailed reports, rich Markdown text, detailed explanations, documents, lists, tables, and code that the user should read. When generating a report, write the full report in a canvas and give only a brief spoken summary. To show the user a picture, chart, diagram or screenshot, save it as a PNG, JPEG, GIF or WebP in the chat folder and call show_image; a canvas can also include a picture from the folder with Markdown image syntax. Pictures the user sends arrive with their message; look at them before answering. Briefly introduce or summarize the canvas in plain speech instead of reading its contents aloud. All user-facing replies in this voice turn, including updates and replies after tools, will be read aloud by text-to-speech. Write plain conversational text in short, clean sentences or simple lines. Do not use Markdown headings, bold, italics, bullet or numbered lists, tables, backticks, code fences, decorative symbols, or Markdown links. Describe steps naturally with words such as first, next, and finally. Avoid raw URLs, long file paths, and command or code dumps in spoken replies; briefly explain the result instead. Write numbers, units, and abbreviations in an easy-to-say form when it improves clarity without changing meaning. Use normal punctuation for natural pauses. You may occasionally include these exact nonverbal emotion tags when they fit the response naturally: (laugh), (cough), (clears throat), (sigh). These are speech cues, not words to explain or read literally. Use them sparingly; never add them to tool arguments or generated files. These presentation instructions apply only to user-facing speech: keep tool calls, tool arguments, code edits, and generated files in their required formats.';

export const AUDIO_SYSTEM_RULE = 'The portal prefixes user requests sent in voice mode with [Audio mode], including microphone transcriptions and typed requests that should receive spoken replies. This paragraph only describes the marker: it does not mean any request has it. A request is spoken only when its own text begins with the line [Audio mode]. Decide the reply format from the latest user request only. When it starts with [Audio mode], follow these speaking rules for the entire reply, including updates after tools: ' + VOICE_INSTRUCTIONS.trim() + ' Do not read the marker aloud. When the latest user request has no [Audio mode] prefix, use normal chat formatting; an audio marker in older conversation history does not keep voice mode enabled.';
/** Off for the comparison baseline: no marker on messages and no rule for them. */
export function voiceRulesOn(): boolean { return process.env.VOICE_RESPONSE_INSTRUCTIONS !== 'false'; }
export function audioMessage(text: string) { return voiceRulesOn() ? AUDIO_MESSAGE_PREFIX + text : text; }

/** Whether a message in these entries was spoken, or typed in voice mode. */
export function spokenIn(entries: readonly any[]): boolean {
  return entries.some((entry) => isUser(entry) && textOf(entry.message.content).startsWith(AUDIO_MESSAGE_PREFIX));
}

/**
 * The rule for spoken replies, in the system prompt of a conversation that has
 * had voice and no other.
 *
 * In every other one it was a paragraph about [Audio mode] that no message
 * carried, and the model took a typed message for a spoken one: in the chat
 * behind issue #26 its thinking said the message began with the marker.
 *
 * Part of pi's own system prompt, added to what the resource loader supplies,
 * so it is there whenever pi builds that prompt again — for tools that come and
 * go during a run too. Said from what the conversation holds and the message
 * being sent, as it would be after a restart: going back to typing keeps it,
 * so the model's cache of the prompt still counts; a conversation whose last
 * spoken message is edited away loses it.
 */
export class AudioRule {
  private on = false;
  lines(): string[] { return this.on ? [AUDIO_SYSTEM_RULE] : []; }
  /** Whether that changed what it says. */
  set(on: boolean): boolean {
    on &&= voiceRulesOn();
    if (on === this.on) return false;
    this.on = on;
    return true;
  }
}

/** First-call thinking is transient; formatting is governed by AudioRule. */
export class VoiceFirstTurn {
  private active = false;
  private first = false;
  arm(first = true) { this.active = true; this.first = first; }
  reset() { this.active = false; this.first = false; }
  extension = (pi: any) => {
    pi.on('before_provider_request', (event: any, ctx: any) => {
      if (process.env.VOICE_SKIP_FIRST_THINKING === 'false') return;
      const provider = ctx.model?.provider as string | undefined;
      if (!this.active || !this.first || !(provider === 'llama.cpp' || provider?.startsWith('llama-server'))) return;
      const payload = { ...event.payload, chat_template_kwargs: { ...event.payload.chat_template_kwargs, enable_thinking: false } };
      delete payload.thinking_budget_tokens;
      return payload;
    });
    pi.on('turn_end', () => { this.first = false; });
    pi.on('agent_end', () => this.reset());
  };
}
