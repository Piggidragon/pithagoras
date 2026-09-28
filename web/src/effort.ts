import { labelOf, msg } from "./i18n";

/** pi's thinking levels, as they are shown: pi's own word for one it adds later. */
const LEVELS: Record<string, string> = {
  off: msg("off"),
  minimal: msg("minimal"),
  low: msg("low"),
  medium: msg("medium"),
  high: msg("high"),
  xhigh: msg("xhigh"),
  max: msg("max"),
};

export const effortLabel = (level: string): string => labelOf(LEVELS, level);
