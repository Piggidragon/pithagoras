import { t } from "../i18n";
import { ImagesAddon } from "./FeatureAddons";
import { Section } from "./SettingsUi";

/**
 * The settings of the agent's picture tools: the image endpoint behind making
 * and changing pictures, and whether the agent has those tools at all. The tools
 * themselves are switched in the tool lists like any other, in their one Images
 * group; the endpoint and the add-on's on/off state are the add-on's, which used
 * to be a tab of Settings → Add-ons.
 */
export function PicturesPanel({ onError }: { onError: (e: string) => void }) {
  return (
    <Section
      title={t("Making and changing pictures")}
      hint={t("The image model behind generate_image and edit_image, and whether the agent has them at all.")}
    >
      <ImagesAddon onError={onError} />
    </Section>
  );
}
