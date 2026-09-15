# Pithagoras: development context for future videos

Recorded 11 September 2026. This is a production notebook, not a finished script or a claim that every experiment succeeded. It preserves the decisions and measurements from our incremental development conversation. Use the final-state section when describing what runs now; use the chronology when telling the story of how we got there.

## The project and the goal

Pithagoras is a self-hosted interface for AI sessions, with tools, browser access, terminal work, and voice. The goal of this development stretch was to turn a text-first agent into a hands-free assistant that can listen, respond aloud, be interrupted, and show its work visually.

The constraint makes this useful video material: Qwen, speech generation, and eventually vision share one NVIDIA RTX 3060 with 12 GiB VRAM on the home-lab machine **Cortex**. The user explicitly authorized live updates to that home lab. This was iterative engineering on a working deployment, with several corrections driven by actual use.

Local repository: `projects/pi-portal` inside the Claude workspace. Deployed checkout: `/opt/pithagoras` on Cortex. Portal: HTTPS port 4100. Remote model presets: `/root/models/models.ini`.

This notebook does not establish that the repository was pulled, committed, or pushed during every iteration. There are substantial local changes; deployment and Git publication are separate things.

## Development chronology

### 1. Add voice to existing sessions

The initial request was for a voice add-on, like the browser add-on, available to sessions. Whisper performs **speech-to-text**, not TTS. Breeze-TTS-2 supplies the spoken response.

Decisions and implementation:

- Run the speech services on the same Cortex host as Pithagoras.
- Keep Qwen and TTS running together rather than treating the GPU as dedicated to one experiment.
- Use a mic icon in the composer instead of a textual “Voice” button.
- Add hands-free microphone operation, automatic voice activity detection, end-of-turn handling, and barge-in.
- Mute means “stop listening”; it does not end the agent session or stop its spoken output.
- End voice mode returns to the ordinary chat interface.
- Add an input-language selection so Whisper does not always have to infer the language.
- Add live transcription so work can begin before the utterance finishes; finalize and send at the detected turn boundary.

The transcript contains the user's repeated concern about latency. The target was conversational flow, not merely demonstrating that speech recognition and synthesis could run.

### 2. Replace the first voice UI

The first composer/voice controls were rejected as ugly. The user supplied screenshots and requested a broader redesign.

The resulting voice experience:

- Hide the normal chat/textbox in voice mode and center an animated audio-reactive orb.
- Keep tool-choice dialogs available when the agent needs a selection.
- React to actual microphone and playback levels rather than only playing a decorative idle animation.
- Differentiate input and output with color: mint input, violet output, blue idle, slate muted.
- Provide mic mute, end, and optional sound effects without crowding the stage.
- Add a collapsible left sidebar with a saved preference.

Subsequent visual corrections mattered:

- Improve the contrast of the whole orb system: orb, status, controls, floating panels, and tool cards.
- Move the compact dock to the bottom center, including terminal-only mode.
- Increase the canvas from 420 to 600 with CSS overscan, keeping the orb's visual size while allowing its halo to fade beyond the layout box. This fixed the visibly cropped glow.
- Widen the compact dock to 520 px, constrained on small screens, while keeping its height at 80 px.
- Add a two-line live thinking preview in the compact dock, following the newest text. It clears when the reply starts or the thinking item finishes; compaction uses its own status.

### 3. Make tools part of the voice stage

Browser activity brings in a floating browser panel. Terminal activity brings in a floating terminal panel. When both are visible, the browser gets the larger area and the terminal sits alongside it; layouts resize for mobile.

The orb and controls shrink into the centered dock as tool panels appear. Transitions connect the full and compact layouts.

Tool action cards:

- Show a readable action name and a short actual detail, such as a command or tool name.
- Reflect completion or failure.
- Show new activity rather than replaying old history on entry to voice mode.
- Alternate left/right from the orb, then drift upward and fade over eight seconds.
- Bound the visible set to four cards and respect reduced-motion preferences.

The animation was explicitly refined from “appear and fade” to “fly outward first, then slowly move upward and fade.”

### 4. Improve the speech pipeline

The user noticed choppy audio and delays caused by waiting for the whole response. The intended architecture is overlapping stages:

`model text stream → phrase queue → TTS generation → audio queue → playback`

While one phrase plays, TTS can generate the next; while that happens, the model can continue producing text.

Implemented behavior:

- Queue speakable chunks as assistant text arrives.
- Split at sentence boundaries and also at an em dash (`—`).
- Combine very short sentences with the next phrase so TTS does not receive lots of tiny fragments.
- Flush a short final reply instead of waiting forever for another sentence.
- Keep speech ordered with a producer/consumer pipeline and at most two prepared phrases ahead of playback.
- Allow streaming PCM playback before the TTS request has fully finished.
- Buffer roughly 0.65 seconds of initial PCM and schedule audio buffers contiguously.
- Cancel pending generation and playback for barge-in/end.
- Handle both input and playback levels for the orb.

Important distinction for videos: **text chunking** and **audio streaming inside a TTS request** are different optimizations. We implemented both.

### 5. Use Aria's reference voice and a faster TTS runtime

The default voice was replaced with Aria's reference audio/transcript. The existing reference was verified against the source reference; no new voice-training run is established by this history.

The original Python Breeze service consumed about 7.8 GiB VRAM. Faster Python/depth experiments hit out-of-memory errors and were rolled back. The successful route was native **audio.cpp**, using Breeze-TTS-2 Q8 GGUF with CUDA.

Recorded measurements:

| Measurement | Result | Scope |
| --- | --- | --- |
| Python Breeze example | About 8.4 s generation | One benchmark phrase |
| Native warm example | About 3.05 s for 4.88 s audio | Same benchmark text |
| Native first audio | About 0.94 s | Benchmark example |
| Through portal | About 4.94 s for 8 s audio; first audio about 0.989 s | Separate portal example |
| Native TTS VRAM | About 4,414 MiB | Observed runtime footprint |
| Earlier Python TTS VRAM | About 8,012 MiB | Observed runtime footprint |

These are measured examples, not universal latency guarantees. Text length, GPU contention, warm-up, and concurrent work affect performance. An Aria output WAV was transcribed with Whisper and matched the expected words.

Current TTS service is `pithagoras-audio-cpp.service`, port 7861. The older `pithagoras-breeze.service`, port 7860, is stopped/disabled as a fallback. Whisper runs as `pithagoras-whisper.service`, port 8178, using multilingual base on CPU with four threads.

### 6. Fix voice stalls and contention

Observed failure: voice mode sometimes stayed on “Thinking”; closing voice mode revealed a response beginning in chat. The browser console also showed repeated HTTP 409 speech errors.

Changes included:

- Do not hold response playback behind the send acknowledgement once the response is already arriving.
- Return from prompt acceptance instead of making acceptance wait for the entire agent run.
- Retry transient busy TTS responses on the server rather than creating repeated client failures; retain compatibility handling for older responses.
- Tie cancelled upstream generation to an AbortController so interrupted prefill does not continue blocking the single model slot.

Do not present all waiting as a voice bug: later investigation also found genuine long prompt-prefill work.

### 7. Make voice replies speakable without changing the prompt prefix every turn

The first approach used temporary voice instructions. The user wanted them present for microphone messages and for typed requests while voice mode was active, but absent from subsequent normal chat requests.

The final design uses:

- A **permanent conditional system rule**, shared by normal and voice sessions.
- The prefix `[Audio mode]\n` on requests that should get spoken replies.
- The latest user message determines whether voice formatting applies; an old audio marker does not keep later ordinary chat in voice mode.
- The UI hides the literal marker and decorates the message with an Audio badge.

Speaking rules include concise plain language, no Markdown formatting that sounds awkward aloud, and a brief spoken explanation **before every tool call or group of tool calls**. Tool arguments and file contents retain their required formats.

The user also requested occasional emotion cues: `(laugh)`, `(cough)`, `(clears throat)`, `(sigh)`. These remain available to TTS but are hidden from displayed assistant text in audio replies, including partial tags during streaming.

A first-response optimization disables thinking for the initial voice response through provider options, allowing a short immediate response; later calls may think. This is not a promise that the model never reasons during a voice session.

A custom Qwen chat-template experiment was explicitly reverted. The final setup uses the original template. Do not describe the custom template as a retained feature.

### 8. Add useful waiting cues

Normal thinking can trigger one short randomly selected phrase after about 1.8 seconds, such as “Let me think about that for a moment.” Immediate repeat selection is avoided, with a 20-second cooldown. Fast replies suppress the cue.

Compaction was initially misrepresented as ordinary thinking. This was fixed using the SDK's `compaction_start` and `compaction_end` events:

- Show “Compacting context.”
- Announce one dedicated phrase, e.g. “My context is getting full. Let me quickly compact our conversation before I continue.”
- Cancel pending/in-flight normal thinking cues and suppress them during compaction.
- Return to normal status afterward.

The compaction update passed 21 voice/pipeline tests and the production build.

### 9. Improve prefill and add disk-backed session cache

The user correctly challenged prefill speeds around 100 tokens/sec and asked to inspect the actual settings.

Batch settings changed to **batch 2048 / ubatch 1024**, with **threads 6** and **one slot**. An earlier 2,120-token test with those larger batches recorded about 618.68 tokens/sec. An older roughly 11k-token example with batch 512 / ubatch 128 was around 117 tokens/sec; these different-sized examples are not a controlled A/B comparison.

Disk cache implementation:

- Enabled for `qwen36-35b-a3b-mtp` through `LLAMA_DISK_CACHE_MODELS`.
- Serialize restore, inference, and save for the single model slot.
- Save after each successful model response through the portal chat-completions proxy, including a response that requests tools.
- Failed/interrupted responses do not trigger a save.
- Restore when switching to another session; consecutive requests in the same resident session reuse memory.
- Use one deterministic SHA-256 filename per **model + session**. Each save overwrites the same file (`wb` in llama.cpp); it does not accumulate a new file per turn.
- Store files under `/root/models/session-cache/`.
- Missing/incompatible files fall back to normal evaluation.

A small restore test reused 864 cached tokens in an 881-token continuation, reducing its measured processing to about 402 ms; raw restore was about 13.5 ms in that example. Exact repeated prompts can behave differently from ordinary continuation with this hybrid model.

Observed cache files included roughly 94 and 107 MiB session files. Direct `/completion` benchmarks bypass the portal's disk-cache mechanism. Cache growth across distinct sessions is not currently bounded by an automatic retention policy.

### 10. Move a few expert layers to the GPU and disable mmap

Initial `n-cpu-moe = 99` kept all expert layers on CPU. The model metadata reported 41 blocks, so reducing 99 by just one would not have moved experts onto the GPU.

Changed the Qwen section to:

- `n-cpu-moe = 38`
- `load-mode = none`
- `no-mmap = 1`

The installed llama.cpp help documents `none` as the no-special-loading mode. Its loader also warned that CPU tensor overrides with mmap could perform better with `load-mode none`.

Controlled A/B: same **4,226-token prompt**, three runs per configuration, `cache_prompt=false`, one output token. Every run reported `cache_n = 0`.

| Configuration | Prefill tokens/sec, three runs | Approx. mean |
| --- | --- | --- |
| Old: CPU MoE 99, mmap | 565.95, 573.82, 573.05 | 571 |
| New: CPU MoE 38, no mmap | 814.46, 817.89, 821.25 | 818 |

That is about **43% higher throughput**, or about **30% less prompt-processing time**: roughly 7.40 s down to 5.17 s. Both settings changed together, so this test does not isolate how much each contributed. Request wall time sometimes included queueing and model loading; the comparison uses the server's prompt-processing timing.

After restoring the new configuration, Qwen plus TTS had about 2,542 MiB free VRAM. MTP was already enabled during these tests (`draft-mtp`, max draft length 2); runtime confirmed speculative decoding. It was not newly added afterward.

### 11. Reduce browser data, then correct over-filtering

Playwright MCP is pinned to **0.0.79** because a previous signature change from `{element, ref}` toward `{target}` broke agent calls. The portal normalizes common reference decorations.

First optimization:

- Set `--snapshot-mode none` to avoid automatic whole-page snapshot output after every action.
- Encourage `browser_find` and targeted snapshots.
- Initially inject depth 4 into unqualified `browser_snapshot({})` calls.

An initial page sample fell from 35,832 to 1,318 characters, about 96%. That reduction was real but **not a successful general solution**: on Reddit, it hid the posts and left navigation/header content. The model blamed an automation quirk, retried navigation, and became confused.

Final correction:

- Remove the forced depth-4 injection entirely.
- `browser_snapshot({})` returns the full accessibility tree.
- Keep snapshots on demand and keep targeted searches/reads available.
- Update the system guidance to make full versus explicitly limited snapshots clear.

A later unrestricted page snapshot was 197,604 characters, demonstrating that full reads can still be large. Do not claim the final system has a universal 96% reduction or a semantic “useful content only” filter. The retained optimization is avoiding repeated automatic dumps, not silently removing deep content.

### 12. Enable Qwen vision and browser screenshots

Downloaded the requested projector from:

https://huggingface.co/unsloth/Qwen3.6-35B-A3B-GGUF/blob/main/mmproj-BF16.gguf

Stored at `/root/models/qwen36-mmproj-BF16.gguf` and configured through `mmproj` in the Qwen preset. File size is about 903 MB (860 MiB download display).

Verified SHA-256:

`356dfaa3111376a4f7165e32e8749713378d1700b37cf52e0c50d9f23322334d`

Verification:

- llama-server reports `vision: true`.
- The pi-llama-cpp adapter already discovers image capability through model props.
- Browser MCP screenshot returned an image content block.
- A screenshot sent to Qwen was correctly read as command `npm run build` and final output `Build completed successfully.`
- Qwen, MTP, the GPU vision projector, and TTS remained running together.
- Observed free VRAM after the image test: **1,292 MiB**, about 1.26 GiB.

These checks verified the screenshot tool output and model image endpoint separately. They do not establish a recorded end-to-end agent screenshot conversation or a newly implemented drag-and-drop image-upload UI.

## Final configuration reference

Qwen preset essentials at the end of this development stretch:

```ini
[qwen36-35b-a3b-mtp]
model = /root/models/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf
mmproj = /root/models/qwen36-mmproj-BF16.gguf
slot-save-path = /root/models/session-cache/
load-mode = none
no-mmap = 1
ngl = 99
n-cpu-moe = 38
moe-cache-profile = /root/models/traces/qwen35b-merged.csv
moe-cache-slots = 0
kv-offload = 1
parallel = 1
fa = 1
batch-size = 2048
ubatch-size = 1024
spec-type = draft-mtp
spec-draft-n-max = 2
ctx-size = 32768
ctv = q8_0
ctk = q8_0
```

Global threads: 6. Router retains at most one loaded model. Original Qwen chat template retained. The router's `--cache-ram 4096` is distinct from the portal's per-session disk slot cache.

Native TTS uses Breeze Q8, Aria reference audio, CUDA, guidance scale 1, one reference-cache slot, eight frames per stream event, and lookahead margin 12. Deployment files are in `deploy/cortex-voice/`. Treat runtime memory numbers as snapshots, not guaranteed reservations.

## Where to look in the code

- `web/src/hands-free.ts`: turn coordination, barge-in, thinking and compaction cues.
- `web/src/live-transcription.ts`: incremental STT.
- `web/src/speech-pipeline.ts`: ordered generation/playback queues.
- `web/src/pcm-stream.ts`: streaming PCM buffering and playback.
- `web/src/voice.ts`: text chunking, speech formatting, hidden display tags.
- `web/src/components/VoiceControl.tsx`: microphone, TTS requests, event integration.
- `web/src/components/VoiceStage.tsx`: orb, compact dock, thinking preview, floating panels.
- `web/src/components/VoiceToolActivity.tsx` and `web/src/index.css`: tool flights and visual treatment.
- `server/src/api/voice.ts`: Whisper/TTS integration and runtime selection.
- `server/src/pi/voice-first.ts`: permanent audio rule, marker, first-call thinking control.
- `server/src/pi/browser-snapshot.ts`: final browser-reading guidance, with no imposed depth cutoff.
- `server/src/api/browser.ts`: pinned MCP and on-demand snapshot configuration.
- `server/src/llama-session-cache.ts` and `server/src/llama-progress.ts`: serialized cache lifecycle and forwarding.
- `tests/` and `tests/browser/voice.spec.mts`: regression coverage and browser fixture checks.

## Video material worth capturing next

These are candidate beats, not a finished script:

1. Start with the working experience: speak, interrupt, watch the browser/terminal appear, and hear the agent continue.
2. Explain the shared 12 GiB constraint with the progression from Python TTS to native streaming TTS to adding vision.
3. Show the pipeline with overlapping model text, TTS generation, and audio playback. Separate first-audio latency from total generation time.
4. Show the controlled 571 → 818 tokens/sec prefill comparison, keeping the prompt and cache settings visible.
5. Demonstrate switching away from and resuming a session, with cache save/restore evidence.
6. Include the failed snapshot optimization: a smaller payload was not better when it removed the content the task needed.
7. Show the UI evolution: original composer screenshot, full orb, compact thinking dock, tool flights, and simultaneous browser/terminal layout.
8. Show compaction honestly as its own activity instead of disguising it as ordinary thinking.

Before recording, remeasure latency/VRAM on the current build, collect actual end-to-end footage, and verify the exact settings used. Avoid exposing credentials, private chat text, browser logins, or unrelated terminal content in captured footage.

Temporary development screenshots were written to `/tmp/pithagoras-voice-*.png`; these are not durable assets. Capture or deliberately archive chosen footage before relying on it for editing.

## Follow-up: screenshot hallucination root cause

After enabling the projector, actual agent screenshot replies were still hallucinated. Inspection of saved session tool results found **text-only screenshot results**, not image blocks. Playwright MCP 0.0.79 calls `registerImageResult` only when the screenshot's `filename` argument is absent. The agent habitually supplied names such as `picsum-image.png`, turning the response into a saved-file link rather than visible image content.

Fix: normalize browser screenshot calls (direct and MCP proxy) to omit `filename`, preserving target, scale, full-page and explicit image-format options. Playwright still saves an automatically named file and now returns inline image data. Added guidance that a saved-file link is not visual evidence. This explains why the earlier separate no-filename MCP test and direct model image test passed while the agent's named-file calls failed.

## Follow-up: expand the context to 64k

The context was doubled from 32,768 to **65,536 tokens**. The first attempt retained CPU MoE 38: the model loaded and processed 41,406 uncached tokens, but concurrent speech generation hit a CUDA allocation error with only about 630 MiB free. Loading successfully alone did not prove the combined workload would fit.

Final revision: **n-cpu-moe = 39**, moving one additional expert layer to CPU while preserving no mmap, batch 2048, ubatch 1024, one slot, Q8 KV, MTP, and the GPU vision projector. A 41,406-token uncached prompt completed at about **773 tokens/sec** while TTS was also tested; this is not directly comparable to the earlier shorter, uncontended A/B. TTS returned 384,000 bytes of PCM (8 seconds), first audio about 1.82 seconds, completion about 10.03 seconds during that load. The screenshot reading test also passed afterward. Observed free VRAM was about 1,086 MiB after concurrent prefill/TTS. The portal was restarted to refresh discovered model limits.

This follow-up supersedes the earlier final-state context of 32,768 and CPU MoE value of 38. Larger screenshots or different concurrent loads can require more memory than these tests; the recorded workload is the validation scope.

## Follow-up: snapshot notation cleanup and protected compaction

Added content-preserving formatting of browser snapshot trees: shorter reference notation, one-space hierarchy indentation, implicit generic roles, and shorter pointer metadata. Labels, node count, URLs, states, and references remain; no depth cap or extra truncation is introduced. Real samples initially showed about 5–6% fewer Qwen tokens, so do not claim dramatic compression. The formatter also handles already-truncated snapshot text without concealing that upstream truncation.

During voice-mode compaction, detected speech no longer aborts the agent or submits a new request. A spoken wait reminder is limited to once per eight seconds. An utterance that begins during compaction is discarded even if compaction ends before the utterance does. Successful compaction gets a spoken completion announcement; aborted/failed compaction is described as stopped. Normal microphone barge-in resumes afterward. The snapshot and voice/pipeline regression run passed 25 tests.

## Follow-up: live session canvases

Added session-scoped document canvases with create/list/read/write/delete agent tools, a live document panel, and inline human editing. Streaming write prefixes are decoded and persisted before the tool finishes; interruption retains the partial document instead of discarding it or inventing the missing text. Revisions prevent stale overwrites. Human saves mark the document edited and require an AI read before another write. The AI can continue its own edits without rereading, and read state is retained within the session database across controller restarts.

The final panel rule is **at most two work panels plus the orb**. Opening a third minimizes the least recently opened panel. One work panel stays right with the large orb left; two work panels use the compact orb below, and canvas receives more width than terminal. Minimized canvas state and unsaved edits are retained. The user requested a feature branch and Git commits for the accumulated work; implementation moved to `feature/voice-and-session-canvases`.

Validation: production build passed; 57 backend tests passed. Ten browser scenarios passed across the regression run and corrected mobile fixture rerun, including the two-panel compact orb, one-panel large orb, inline editing and partial drafts. Live authenticated API checks on Cortex passed create/edit/persistence/stale-revision rejection/delete in a disposable session. Streaming interruption was verified with SDK-shaped events in automated tests; a full live-model interruption demonstration remains useful footage to record.

Follow-up layout polish: removed the browser's inherited horizontal centering transform in the browser/canvas split, aligned panel edges with a 16px gap, and moved voice workspace controls into one icon-only row at bottom right. The compact orb sits above the controls. Desktop panel transitions and mobile control checks passed.

User refinement: microphone mute and end remain attached to the orb; only workspace toggles and sound-effects controls move to the bottom-right row.

## Follow-up: voice add-on automatic installation

Added Settings lifecycle controls for a Docker-managed voice runtime: download a pinned CUDA build image, compile pinned audio.cpp and CPU Whisper, download the full-precision Breeze GGUF repack, quantize locally to Q8, inspect and atomically publish it, and connect ready endpoints automatically. Models and completed builds live in a named volume. Stop releases GPU memory; restart reuses the files. Existing custom services and Aria reference files are preserved. Managed endpoints use separate loopback ports (8188/7862). Browser UI lifecycle tests pass. Live installation completed: full-precision download with SHA-256 verification, local Q8 conversion, and CPU Whisper transcription. The installer uses resumable parallel downloads after a sequential download stalled. Native model management is enabled explicitly for load/unload APIs.

Lazy-loading refinement: the managed runtime starts without loading Breeze. Voice activation acquires a per-tab connection and preloads the model; End releases it. Last-tab disconnect unloads the model, abandoned leases expire after 75 seconds, and native idle unloading provides a 90-second fallback. Mute retains the lease. A Settings option keeps the model warm instead. Unit checks cover two tabs, lease expiry, and disconnect during load; browser checks cover activation and release.

Live lazy-load check on Cortex: GPU usage was 20 MiB before connection, 3,693 MiB after loading (5.08 seconds), and 165 MiB after unloading. Generated 176,640 bytes of streamed PCM successfully. These are observations for this test workload, not peak VRAM guarantees. Whisper transcribed the JFK fixture correctly. At that checkpoint, the portal and managed voice container were stopped after validation. The portal was subsequently started at the user’s request; see the later deployment notes.

Add-on settings now use Browser and Voice tabs. Tabs support arrow keys and Home/End, load each add-on on its first visit, and retain mounted panels so switching does not discard unsaved settings or interrupt setup progress. Production build passed.


## Follow-up: custom voice library

Settings → Add-ons → Voice now supports named designed voices and reference clones.
Users upload a 1–30 second clip, enter its exact transcript and a voice description,
then save and select the preset. Browser audio decoding normalizes supported files
to mono 16 kHz PCM WAV. SQLite stores presets and private reference recordings.
The UI supports preview and deletion; deleting the active preset restores the
built-in designed voice. Both TTS adapters receive the selected preset's reference
and description without additional model downloads or training.

Validation includes browser upload/conversion, selection, settings save and deletion;
backend persistence, input validation, deletion fallback and native TTS reference forwarding.

Deployed to the running Cortex portal. Authenticated live checks passed voice creation, listing, reference retrieval and deletion. Production build and 65 backend tests passed across the full run and corrected test-fixture rerun; voice-library and add-on browser checks passed.

Voice Settings UX refinement: everyday voice selection and conversation preferences now have separate cards. Service lifecycle and GPU controls sit in an expandable section with a visible status badge; custom runtime/endpoints are tucked into Advanced connection. Shorter help text, more field spacing and a sticky save footer reduce scanning and scrolling. Installation and custom voice browser workflows passed, and the production build passed.

Voice save-footer polish: extend the opaque sticky footer through the settings scroll pane’s side and bottom padding so scrolling content cannot peek below or around it.


## Follow-up: 128K context with MTP and Q8 cache

On Cortex, the Qwen3.6 35B A3B preset in /root/models/models.ini now uses ctx-size=131072 (previously 65536), with explicit spec-draft-type-k=q8_0 and spec-draft-type-v=q8_0. The installed moe-qwen38 fork creates the embedded MTP context from the target context parameters, so MTP already inherited the target's Q8 K/V types; the explicit draft flags do not create additional savings in this path. Other model presets were preserved. A timestamped preset backup was saved before reloading the idle model.

The slot reports n_ctx=131072 and speculative=true. Total GPU usage was 7333 MiB with the LLM loaded, then 11365 MiB after concurrent TTS and a 4219-token prefill test, leaving 546 MiB reported free. Prefill measured 822 tokens/sec in that test; both text and streamed audio returned successfully. These are short validation runs, not a full 128K or simultaneous image/TTS stress test. VRAM headroom with Breeze loaded is tight. Voice lazy unloading remains enabled; no model weight, CPU expert count, batch, ubatch or slot changes were made.


## Latest checkpoint — September 12, 2026

This checkpoint consolidates the recent changes for future video scripting. The
128K configuration below supersedes the earlier 32K and 64K checkpoints.

### Settings and voice experience

- Browser and Voice have separate add-on tabs, with keyboard navigation and preserved unsaved state when switching tabs.
- Voice setup downloads the model, quantizes it locally to Q8 and manages the Docker service from Settings. Lazy loading keeps Breeze off the GPU until a voice session connects; mute keeps the session connected, while the last disconnect releases the model.
- The voice library supports named designed voices and clones from uploaded recordings. Clones use a clean 1–30 second clip (source file up to 20 MB), an exact transcript and a voice description. The browser normalizes audio; SQLite persists recordings and presets. Users can select, preview and delete voices. Save new voice creates the preset; Save voice settings activates the selection.
- Voice settings are grouped into Your voice and Conversation cards. Voice service and Advanced connection expand when needed, with service status visible while collapsed. Help text is shorter and fields have more spacing.
- The sticky save footer now covers the scroll pane’s side and bottom padding, fixing content peeking beneath it. The final margin override prevents the section-spacing utility from reopening the bottom gap.
- These UI changes are deployed on Cortex. Production builds passed, installation and custom-voice browser workflows passed, and the portal returned HTTP 200 after deployment.

### Running Qwen configuration after the context change

| Setting | Value |
| --- | --- |
| Model | Qwen3.6-35B-A3B-UD-Q4_K_M.gguf |
| Context | 131,072 tokens, one slot |
| Main KV cache | K q8_0, V q8_0 |
| MTP | draft-mtp, maximum 2 draft tokens |
| Explicit draft cache flags | K q8_0, V q8_0 |
| CPU MoE layers | 39 |
| Batch / microbatch | 2048 / 1024 |
| Threads | 6 |
| Loading | no mmap / load-mode none |
| Vision projector | qwen36-mmproj-BF16.gguf |

The installed fork already inherits Q8 cache types for embedded MTP. Do not frame
this as new quantization savings: doubling the context used existing VRAM headroom.
The preset backup is `/root/models/models.ini.before-128k-20260911-200854` on Cortex.
The date in that filename reflects the host clock. The changed preset is
`qwen36-35b-a3b-mtp`; other presets were left intact.

Validation: the server reported a 131,072-token slot with speculation enabled.
A short text check returned correctly and accepted 4 of 4 draft tokens. A separate
concurrent text/TTS check processed 4,219 prompt tokens at 822 tokens/sec and returned
222,720 bytes of PCM. Total GPU usage afterward was 11,365 MiB, with 546 MiB reported
free. The LLM-only loaded measurement was 7,333 MiB total GPU usage. These are
workload-specific observations, not peak-memory or sustained-speed guarantees.
A full 128K conversation and image processing alongside TTS remain untested.

### Relevant commits

- `ce3fd09`: automatic voice setup and lazy GPU loading.
- `b494856`: add-on tabs.
- `28cd321`: custom voice presets and reference uploads.
- `47f8d6c`: organized Voice settings.
- `198aa38`: save-footer padding fix.
- `d40df4f`: Q8 MTP and doubled-context validation notes. The actual model preset change lives on Cortex, outside the portal repository.


## Correction: 128K voice memory failure; user-selected 100,000 context

The 128K trial was not stable for the real voice workload. Subsequent Breeze logs
showed cudaMalloc failures for speech-decoder buffers (~172 MiB) and decode-graph
buffers (~552 MiB), breaking streamed speech. Earlier short tests were insufficient
to establish reliable operation. The user also reported a llama-server error after
prefill followed by a network error. Model logs showed missing saved-cache files
and a canceled connection; the missing-cache request retried prefill and completed.
There was no logged llama GPU crash in the inspected period. Do not claim the TTS
OOM conclusively explains the separately reported model/network error.

After a brief restoration of 64K, the user requested **ctx-size=100000**. That is
now the active preset; the server rounds the allocated slot to **100096** tokens.
Q8 main/draft flags, MTP, one slot, batch 2048, ubatch 1024 and CPU MoE 39 remain.
This supersedes the 128K configuration above.

Validation used the actual Aria reference, saved instruction, fast guidance and
Pithagoras streaming options concurrently with a 4219-token prefill. Text completed
at 831 prompt tokens/sec and Aria returned 326400 PCM bytes. Observed total GPU
usage was 10929 MiB, leaving 982 MiB free. This provides more headroom than 128K,
but does not prove full-context or simultaneous image/TTS stability.


## Follow-up: visible processing progress and canvas recovery

Chat and voice now share a clearer prompt/compaction indicator. Prompt processing
shows actual reported percentage, processed/total tokens and cached tokens in chat,
plus elapsed time; voice keeps a compact percentage/bar beside the orb. When no
percentage is available, and during compaction, an animated indeterminate bar and
elapsed timer communicate ongoing work. Reduced motion is respected. Empty
assistant events no longer prematurely label prefill as writing. Compaction keeps
its identity through internal model events. Split SSE lines are buffered so network
packet boundaries do not discard prompt progress.

Canvas listing now fetches the REST list independently of SSE, refreshes on opening,
and retries while the stream reconnects. Explicit create events open the panel
before content begins; each new write opens/selects its canvas unless a human edit
is in progress. Deleted selections recover to an available document. Canvas SSE
cleanup follows the response lifetime and disables intermediary buffering.

Validation: production build passed; eight focused backend tests covered activity,
SSE fragmentation and canvas persistence/edit safety. Browser checks covered chat
and voice progress, compaction completion, canvas creation/write auto-open,
inline editing, partial drafts, deletion, mobile bounds and listing without SSE.

Active-canvas refinement: an AI read now emits an explicit focus event, so the panel selects the document being read as well as the document being created or written. Human inline drafts retain focus to avoid losing unsaved work.

Deployment verification: authenticated live canvas REST operations and SSE snapshot/create/update/delete events passed on Cortex. The disposable test session was removed.


## Follow-up: separate 80K / 100K presets for Expressive voice

Expressive (guidance 4) subsequently failed at 100K in the user's workload. Breeze
logged CUDA allocation failures for approximately 546–549 MiB decode-graph buffers.
These are failed allocation sizes, not a measured Fast-versus-Expressive VRAM delta.
Fast was briefly restored through Settings API; the user then requested an 80K
context test and separate model presets, retaining manual control of voice mode.

Cortex `/root/models/models.ini` now contains:

- `qwen36-35b-a3b-mtp`: ctx-size=80000, retaining the existing model ID so current sessions use the smaller configuration. The allocated slot rounds to 80128.
- `qwen36-35b-a3b-mtp-100k`: ctx-size=100000, preserving the previous larger-context option. Expressive has not been shown reliable at this size.

Both use the same model weights, Q8 K/V flags, MTP, CPU MoE 39, one slot,
batch 2048 and ubatch 1024. The router's models-max=1 is unchanged, so these
are alternatives rather than two simultaneously resident copies. Preset backup:
`/root/models/models.ini.before-context-variants-20260911-220818`.

At 80K, concurrent 4219-token prefill and Expressive Aria generation passed:
811 prompt tokens/sec, 330240 PCM bytes, total GPU use 10597 MiB and reported
free VRAM 1314 MiB after the test. This used the installed Aria reference,
guidance 4 and the portal's streaming options, without changing saved voice mode.
Longer/full-context and image-plus-TTS stress workloads remain unverified.

TTS chunking now measures spoken words instead of characters: fragments of three words or fewer wait and join the next phrase. Emotion cues do not inflate the word count; a final short reply still flushes so it is not lost. Sentence and em-dash boundaries and concurrent generation/playback remain in place.


## Fix: canvas tools returned empty results to the model

The user's transcript exposed a separate issue from the earlier UI list recovery:
canvas tools returned `{output, isError}`, but the installed pi agent SDK expects
`{content, details}`. Side effects succeeded and documents appeared in the UI,
while the model received an empty content array, including on failed reads.
All canvas tools now return JSON in text content blocks and structured details.
Failures throw through the SDK's error handling so missing IDs and stale edits
arrive as model-visible error messages. The extension now uses the SDK's
ExtensionAPI type, and read guidance explicitly requires an ID from list/create.

Production build and six canvas tests passed, including a real installed-agent-loop
integration check: canvas_list results and a failed canvas_read are asserted in
the next model request. Earlier tests incorrectly assumed the same output field
as the implementation; those assertions now use the SDK content contract.

## Temporary canvases and explicit storage

New canvases now live in server memory by default, with no canvas-table writes until the user chooses the icon-only Store control in the work panel header. Stored documents auto-save subsequent streamed AI updates and applied inline edits. Existing database canvases stay stored. The header also exports Markdown via Download, including an in-progress manual draft. Temporary canvases survive page refreshes but not server restarts; the UI labels that lifetime. Streaming, interrupted partial content, revision checks and read-after-human-edit protections work for both storage modes.

## Voice latency tracing

Added an opt-in gauge control beside the mic and a timing panel with milliseconds, wall-time percentages and JSON export for the last 20 turns. Measures last VAD speech to estimated first generated reply output; prewritten status audio is excluded. Records speculative STT, endpointing, model token/text arrival, prefill progress, tools/compaction, TTS first bytes, playback buffering and scheduled output. Server-Timing supplies Whisper upstream and Breeze header/busy timing. No speech/transcript content is included. Existing 1000ms VAD redemption and 0.65 seconds of audio buffering are unchanged. Software playback timing is an estimate, not an acoustic benchmark. Prepared and tested locally during the Cortex power outage, then deployed on September 13 after power returned. User-exported live traces were analyzed below.

## Voice progress styling and canvas-first detail

Voice prompt processing and compaction now use a slim luminous progress rail and a status light matching the orb's reactive color, with readable elapsed time and percentage. Removed the nested solid blue card; the same treatment fits the full orb and compact dock. Chat progress and microphone/end controls retain their existing layouts. Voice instructions now explicitly ask for brief plain spoken replies (usually one to three sentences), with rich Markdown, documents, tables, lists and code in canvases and only a short spoken summary. The existing latest-request audio marker continues to scope these rules to voice replies.

Prompt processing indicators now wait two seconds before appearing in chat or voice, avoiding a flash on fast replies. Compaction indicators still appear immediately.
Prompt processing also cycles through short reading/context/preparation labels every three seconds while retaining the measured progress and elapsed time. These are presentation labels, not separate measured backend stages.

## Breeze startup profiling and reduced holdback

September 13: multi-turn user timing report contains five completed turns (including the earlier sample) and one VAD misfire. TTS first bytes took 996–1728 ms; transcription finished before endpoint detection. Found and removed duplicate legacy native/Python Breeze systemd units after explicit approval; managed Breeze and Qwen coexist again.

Benchmarked managed audio.cpp with installed Aria, saved Fast guidance=1, seed 42, a fixed two-sentence input, and unchanged Qwen 80K. Three interleaved eight-frame baseline/lookahead-four pairs gave first bytes 943/1074/939 ms versus 594/612/612 ms; time to 0.65 seconds of PCM buffered was 1288/1419/1285 versus 939/957/957 ms. Total generation stayed roughly 1.94–2.08 seconds. Changed only request lookahead from twelve to four; retained eight-frame batches, voice, guidance, and player buffering. Same output length, but PCM hashes differ: perceptual equivalence is not established and listening validation is still needed. This is a fixed-text warm benchmark, not a measured end-to-end conversational improvement.

Deployment and verification: commit `61d1adb` was deployed to Cortex by rebuilding and recreating only the portal service. The running container reports lookahead four in its compiled voice route; the auth status endpoint returned HTTP 200. Production build and all nine voice API tests passed. The controlled benchmark saved about 330–460 ms to first bytes and startup-buffer readiness; this must not be presented as a measured conversational latency reduction until a new live profile confirms it. Listening validation remains pending, especially sentence endings and any choppiness.

The five completed live traces before this optimization measured 2.98–4.10 seconds from last detected speech to estimated first reply audio. Later-turn request setup/prefill to first token was 403–592 ms, versus 1213 ms on the first turn. Turn detection remained about one second; speculative Whisper finished in time and added effectively zero remaining transcription delay. No thinking delay or TTS busy retry was recorded in these completed traces. One VAD misfire was excluded from completed-turn timing.

Memory incident resolution: the old native `pithagoras-audio-cpp.service` had restarted on boot with Breeze already loaded, blocking the managed addon from allocating another copy. Stopped/disabled it and removed both its unit and the already inactive Python `pithagoras-breeze.service` unit after approval; systemd reports both not-found/inactive. The managed model subsequently reported loaded successfully. Observed process VRAM was 6378 MiB for Qwen and 3668 MiB for managed Breeze. No context reduction, model quantization change, or CPU MoE adjustment was needed.

## Adjustable browser VAD

Voice settings now include a collapsible Speech detection section with five Silero VAD controls: end-of-turn silence (200–3000 ms), speech-start/end confidence thresholds, minimum speech duration (64–2000 ms), and pre-speech audio padding (0–1000 ms). Existing defaults remain 1000 ms, 0.65/0.35, 256 ms and 320 ms. Save persists them; starting voice mode applies the saved values. Reset restores defaults. Server validation rejects invalid ranges and end thresholds at or above the start threshold. Production build, ten voice API tests and browser save/reload/reset verification passed.

Voice instructions explicitly require full reports in a canvas with only a brief spoken summary, keeping the existing audio-mode scope.

## Composer actions and chat canvas access

During generation, an empty or whitespace-only composer shows an icon-only Stop action in the send position. Typing switches it to Send for the existing follow-up/steering flow; idle empty input retains disabled Send. Removed the old header Stop button. Non-voice canvas access now sits beside browser and terminal icons in the chat header, while voice mode keeps its existing canvas control. Build and browser verification passed for switching, follow-up submission, stop activation, and header placement.

## Sequential pipeline comparison for the optimization video

Added an opt-in `VOICE_PIPELINE_MODE=sequential` instance mode, leaving the default pipeline parallel. The baseline performs endpoint → one STT request → complete agent turn → synthesize all bounded speech chunks → playback. No speculative transcription, sentence-to-TTS overlap, playback during synthesis, or filler TTS during thinking/compaction. Voice stage labels the instance “Sequential baseline”. Cancellation and existing defaults remain supported. Thirty-three pipeline/transcription/hands-free tests passed, including explicit stage-barrier checks.

Separate Cortex demo uses port 4101, source/image/container `pithagoras-sequential`, fresh data/workspaces, and no copied sessions/channels/routines or API credentials. A new demo login and separate cookie avoid interfering with the main portal. Shared GPU services require one recording at a time. See `docs/guide/voice-comparison.md` for the comparison protocol and remaining intermediate variants. This compares pipeline scheduling on the current optimized model stack, not the original historical implementation.

Comparison correction: per user request, the test instance sets `VOICE_SKIP_FIRST_THINKING=false`. It no longer injects `enable_thinking=false` or strips the thinking budget on the first voice response. Model/provider thinking settings remain authoritative. The production instance retains its existing first-response optimization. Future comparison optimizations are added individually on request.

The comparison now also sets `VOICE_RESPONSE_INSTRUCTIONS=false`, omitting the entire voice response instruction block and input audio marker. This removes brevity/plain-text restrictions, canvas-first report routing, spoken pre-tool announcements and emotion-tag guidance from the demo prompt. Existing sequential stage barriers and normal model thinking remain. Main deployment keeps all voice instructions. Use fresh demo sessions to avoid influence from prior optimized replies; the shared native model/runtime is still current, not the historical Python stack.

Temporary demo reversibility: main port 4100 remains at `3e3c111`; experiment behavior is isolated to port 4101 and recorded in `980cb59`, `9f5b903`, `274a9b5`. Main and current baseline Docker images were pinned under dated tags. The comparison guide records image digests, environment switches, and stop/resume/source-revert steps. Stopping the demo preserves its data and requires no main-instance rollback. No experiment rollback has been executed.

Comparison stage one: enable `VOICE_SENTENCE_CHUNKS=true` on the demo only. Completed text sentences go to TTS while the LLM continues. Each sentence is fully synthesized/buffered before playback; the next sentence synthesis waits for playback to finish. Whisper still starts after endpoint, model thinking remains normal, voice prompt optimizations remain disabled, and PCM streaming playback stays off. The baseline is restored by setting the sentence flag false. Main 4100 is unchanged.

Comparison stage two: enable `VOICE_TTS_PREFETCH=true` on 4101. TTS generates the next queued sentence during playback, keeping a bounded queue of up to two completed phrases. Each sentence still finishes generating before its own playback starts. Whisper remains non-speculative; thinking suppression and voice response instructions remain off. Streaming PCM playback remains off. Stage one is restored by disabling only the prefetch flag. Main instance unchanged.

Script-demo stage: all requested script optimizations are enabled together on 4101: progressive Whisper, one-second VAD silence, first-provider-call thinking suppression, sentence chunking, parallel TTS/playback, and native streamed PCM playback. Breeze is already Q8 audio.cpp; no model conversion occurs in this step. Independent demo cookie/label is retained. Unrequested brief voice instructions and filler speech remain off. Forty-three targeted tests passed; rollback images and environment flags preserve earlier stages.

Demo browser capability added with an isolated Chromium profile and separate CDP/viewer/websocket ports. It uses external-browser discovery so the demo portal needs no Docker socket. Browser MCP navigation/snapshot and viewer smoke checks passed. User also requested ubatch 128: created a distinct `qwen36-35b-a3b-mtp-demo` router alias with batch 2048, ubatch 128, one slot, 80K context; main alias remains ubatch 1024. Runtime arguments verified. Router models-max=1 means alternating aliases may reload the model—exclude cold starts from warm comparison takes. The browser and alias are temporary and independently reversible; see comparison guide.

After recording the ubatch-128 comparison, the user stopped the main portal to prevent it from switching the shared model, then requested the test instance use the regular `qwen36-35b-a3b-mtp` preset again (ubatch 1024, batch 2048). Demo configuration now points to that regular preset; voice optimization flags and private browser remain unchanged. The temporary 128 preset is retained for repeatable comparisons.

Final demo stage: all voice optimizations and presentation instructions are enabled on 4101. Restored voice response/canvas guidance and spoken status feedback by setting `VOICE_RESPONSE_INSTRUCTIONS=true` and `VOICE_STATUS_SPEECH=true`. Existing streaming, progressive transcription, sentence/prefetch pipeline and first-response thinking optimization remain on. Qwen uses the regular ubatch-1024 preset; browser is isolated and enabled. Main portal remains stopped. Earlier baseline/stage settings remain documented and reversible.

### Canvas revision recovery — September 13, 2026
- Fixed a failed live canvas write where the model requested revision 1 after creating revision 0. AI writes now clamp future revisions down to the actual revision before starting the write.
- Stale revisions still fail; unread canvases, user edits requiring a fresh read, and concurrent writes remain protected. The same recovery applies to streamed tool arguments and completed calls.
- Validation: eight canvas tests and production build. Deployed to the test instance on port 4101; main instance remains stopped.
