import { useState } from "react";
import { LuChevronRight } from "react-icons/lu";
import { api } from "../api";
import { failureReason, pictureCall } from "../picture-call";
import { stripAnsi, type Item } from "../transcript";
import { t } from "../i18n";
import { Collapse, ToolArgs, useNow } from "./ChatActivity";
import { ImagePreview, type PreviewState } from "./ImagePreview";

type ToolItem = Extract<Item, { kind: "tool" }>;

/**
 * A generate_image or edit_image call in the chat: the preview in place of the
 * tool card. The call itself — its name, what it was given, and what an error
 * said whole — is under "Details", so that nothing the card showed is lost, and
 * is no longer the main thing.
 */
export function PictureCall({ item, sessionId, folder }: { item: ToolItem; sessionId: string; folder: string }) {
  const [open, setOpen] = useState(false);
  const call = pictureCall(item.name, item.args, folder);
  const running = item.status === "running";
  const now = useNow(running);
  const state: PreviewState = running ? "making" : item.picture ? "done" : "failed";
  const output = stripAnsi(item.output ?? "");
  // A run that ended with the call open never said how it came out: it did not bring a picture.
  const reason = item.interrupted ? t("Interrupted before the picture arrived") : failureReason(output);
  return (
    <div className="picture-call">
      <ImagePreview
        state={state}
        edit={call.edit}
        src={item.picture && api.pictureUrl(sessionId, item.picture.path, item.id)}
        before={call.original && api.pictureUrl(sessionId, call.original)}
        ratio={call.ratio}
        title={item.picture?.title ?? (call.title || undefined)}
        reason={reason}
        elapsed={running && item.since ? Math.max(0, Math.floor((now - item.since) / 1000)) : undefined}
        href={item.picture && api.pictureUrl(sessionId, item.picture.path, item.id)}
        actions={
          <button type="button" className="picture-call-more" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {t("Details")}
            <LuChevronRight aria-hidden />
          </button>
        }
      />
      <Collapse open={open}>
        <div className="chat-tool-body">
          <span className="chat-tool-name">{item.name}</span>
          <ToolArgs args={item.args} />
          {state === "failed" && output && (
            <div className="chat-tool-output-wrap">
              <div className="chat-tool-label">{t("Error")}</div>
              <pre className="chat-tool-output is-error">{output}</pre>
            </div>
          )}
        </div>
      </Collapse>
    </div>
  );
}
