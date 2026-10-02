import { useEffect, useState } from "react";
import { api } from "../api";
import { t } from "../i18n";
import { PICTURE_TOOLS, isPictureTool, nextOff } from "../tool-groups";
import { ImagesAddon } from "./FeatureAddons";
import { Section, SwitchRow } from "./SettingsUi";

/**
 * Everything about the agent's pictures in one place: whether it starts with
 * the tools that show, make and change them, and the image endpoint the last
 * two reach.
 *
 * The tools' defaults are the same list Settings → Tools writes, so the choice
 * is the one stored there; that page leaves these tools out so a switch is not
 * in two places. The endpoint's settings and its on/off state are the add-on's,
 * which used to be a tab of Settings → Add-ons.
 */
export function PicturesPanel({ onError }: { onError: (e: string) => void }) {
  const [off, setOff] = useState<string[] | null>(null);
  /** Picture tools of an extension, under a name of ours: switched in its group in Settings → Tools, where it is listed. */
  const [taken, setTaken] = useState<string[]>([]);
  /** Why there is nothing to switch, where the deployment cannot do it. */
  const [refusal, setRefusal] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.toolDefaults().then((r) => {
      setOff(r.off);
      setTaken(r.tools.filter((tool) => PICTURE_TOOLS.includes(tool.name) && !isPictureTool(tool)).map((tool) => tool.name));
    }, (e) => setRefusal(String(e).replace(/^Error:\s*/, "")));
  }, []);

  const flip = async (name: string, enabled: boolean) => {
    if (!off) return;
    const before = off;
    const wanted = nextOff(off, [name], enabled);
    setOff(wanted);
    setBusy(true);
    try {
      setOff((await api.setToolDefaults(wanted)).off);
    } catch (e) {
      setOff(before);
      onError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const tools: { name: string; detail: string }[] = [
    { name: PICTURE_TOOLS[0], detail: t("Puts a picture from the chat's folder on your screen: a chart it drew, a screenshot, a photo.") },
    { name: PICTURE_TOOLS[1], detail: t("Makes a new picture from a description. It exists only while image generation, below, is on.") },
    { name: PICTURE_TOOLS[2], detail: t("Changes a picture in the chat's folder. It exists only while image editing, below, is on.") },
  ];

  return (
    <>
      <Section
        title={t("Picture tools")}
        hint={t("Which of them a conversation starts with. One chat can still switch any of them the other way for itself, from the blocks icon beside the box.")}
      >
        {refusal ? (
          <p className="rounded-xl border border-line bg-raised/40 px-3 py-2 text-xs text-fg-subtle">{refusal}</p>
        ) : (
          <div className="space-y-3">
            {off &&
              tools.filter(({ name }) => !taken.includes(name)).map(({ name, detail }) => (
                <SwitchRow
                  key={name}
                  title={t("{tool} in new chats", { tool: name })}
                  detail={detail}
                  on={!off.includes(name)}
                  onChange={(on) => void flip(name, on)}
                  disabled={busy}
                />
              ))}
          </div>
        )}
      </Section>

      <Section
        title={t("Making and changing pictures")}
        hint={t("The image model behind generate_image and edit_image, and whether the agent has them at all.")}
      >
        <ImagesAddon onError={onError} />
      </Section>
    </>
  );
}
