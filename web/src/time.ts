import { t } from "./i18n";

/** "5m ago", from the timestamps the server writes (UTC, with or without a zone marker). */
export const when = (iso: string): string => {
  const then = new Date(iso + (iso.endsWith("Z") ? "" : "Z")).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (!Number.isFinite(mins)) return iso;
  if (mins < 1) return t("just now");
  if (mins < 60) return t("{n}m ago", { n: mins });
  if (mins < 1440) return t("{n}h ago", { n: Math.round(mins / 60) });
  return t("{n}d ago", { n: Math.round(mins / 1440) });
};
