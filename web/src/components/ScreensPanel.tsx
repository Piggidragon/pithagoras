import type { Screen } from "../api";
import { Blocks } from "./ScreenBlocks";
import { t } from "../i18n";

/**
 * What the extensions of a chat show of themselves, one screen under another:
 * the blocks each one's glue says, drawn by ScreenBlocks. A screen is as its
 * extension last said it; nothing here can change one.
 */
export function ScreensPanel({ screens }: { screens: Screen[] }) {
  if (!screens.length) {
    return <p className="bg-jobs-empty">{t("Nothing is shown here. An extension's data appears while its chat runs, once it is connected — /screen does that.")}</p>;
  }
  return (
    <div className="h-full space-y-6 overflow-y-auto p-4">
      {screens.map((screen) => (
        <section key={screen.id} aria-label={screen.title ?? screen.id} className="space-y-3">
          {screen.title && <h3 className="text-sm font-medium text-fg">{screen.title}</h3>}
          <Blocks blocks={screen.blocks} />
        </section>
      ))}
    </div>
  );
}
