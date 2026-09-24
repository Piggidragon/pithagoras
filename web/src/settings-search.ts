/**
 * Finding a setting by what it does rather than by where it lives.
 *
 * Each entry names the page it is on and, where there is one, the section
 * heading to scroll to. The words are what someone might type instead of its
 * title — including a few in German, which is what some of the people using
 * this portal think in.
 */

export interface SettingEntry {
  /** The Settings page it is on. */
  tab: string;
  /** An extension's own page instead of a fixed one. */
  ext?: string;
  /** The heading to scroll to, as it is written on the page. */
  section?: string;
  title: string;
  words?: string;
}

export const SETTINGS_INDEX: SettingEntry[] = [
  { tab: "models", section: "Providers", title: "Providers", words: "add provider server endpoint base url address llama.cpp llama-server llama-swap ollama openrouter openai anthropic google vllm lm studio models.json anbieter" },
  { tab: "models", section: "Providers", title: "API keys", words: "key token secret password auth.json openrouter anthropic openai google schlüssel" },
  { tab: "models", section: "Providers", title: "Whether a server answers", words: "status online offline reachable latency loaded running erreichbar" },
  { tab: "models", section: "Providers", title: "Setup assistant", words: "wizard first run getting started onboarding einrichtung assistent" },
  { tab: "models", section: "Provider packages", title: "Provider packages", words: "npm install extension catalog litellm gateway proxy paket" },
  { tab: "general", section: "For new chats", title: "Default model", words: "model provider default new chat standard modell" },
  { tab: "general", section: "For new chats", title: "Effort", words: "thinking reasoning level effort denken nachdenken" },
  { tab: "general", section: "Context", title: "Context window", words: "tokens ctx context window size length kontext fenster" },
  { tab: "general", section: "Context", title: "Kept when compacting", words: "compaction compact keep recent summary kompaktieren zusammenfassung" },
  { tab: "general", section: "Routine reports", title: "Routine reports", words: "routine schedule cron report destination channel bericht" },
  { tab: "tools", title: "Default tools", words: "tools enable disable default on off werkzeuge" },
  { tab: "skills", title: "Skills", words: "skill procedure import repository fähigkeiten" },
  { tab: "mcp", title: "MCP servers", words: "mcp model context protocol server adapter tools" },
  { tab: "extensions", section: "Find packages", title: "Find packages", words: "browse catalog gallery npm pi-package search discover katalog paket" },
  { tab: "extensions", section: "Install by name", title: "Install a package", words: "install npm git url path spec installieren" },
  { tab: "extensions", section: "Installed", title: "Installed packages", words: "extensions packages installed remove uninstall switch off update erweiterungen" },
  { tab: "channels", title: "Channels", words: "telegram discord slack matrix signal email webhook bot kanäle" },
  { tab: "people", title: "People", words: "allow deny stranger contact who users personen" },
  { tab: "browser", section: "Appearance", title: "Theme", words: "dark light mode appearance colour color design dunkel hell" },
  { tab: "browser", section: "Notifications", title: "Notifications", words: "notify alert done finished benachrichtigung" },
  { tab: "browser", section: "Confirmations", title: "Ask before deleting", words: "confirm delete question prompt bestätigen löschen" },
  { tab: "browser", section: "Signed in", title: "Sign out", words: "logout log out password session abmelden" },
  { tab: "add-ons", title: "Add-ons", words: "portal addon optional voice browser terminal" },
  { tab: "shortcuts", section: "Chat", title: "Keyboard shortcuts", words: "keys hotkey keybinding shortcut tastenkürzel tastatur" },
  { tab: "shortcuts", section: "Voice mode", title: "Voice mode shortcuts", words: "voice speak microphone push to talk sprache" },
  { tab: "about", section: "This portal", title: "Where the agent runs", words: "executor container host docker" },
  { tab: "about", section: "This portal", title: "Workspaces", words: "folder path directory workspace ordner" },
  { tab: "about", section: "This portal", title: "pi's files", words: "settings.json models.json auth.json agent directory dateien" },
  { tab: "advanced", section: "settings.json", title: "settings.json", words: "raw json edit file advanced datei" },
];

/** Lower case, without accents: "Schlüssel" is found by "schlussel" too. */
export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * The entries matching every word of `query`, best first: a title that
 * starts with a word, then one that contains it, then a match in its words.
 * `where` says where each one is, and is searched too.
 */
export function searchSettings<T extends SettingEntry & { where?: string }>(query: string, entries: T[], limit = 12): T[] {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const scored: { entry: T; score: number; i: number }[] = [];
  entries.forEach((entry, i) => {
    const title = fold(entry.title);
    const rest = fold(`${entry.section ?? ""} ${entry.where ?? ""} ${entry.words ?? ""}`);
    let score = 0;
    for (const t of terms) {
      if (title.startsWith(t) || title.includes(` ${t}`)) score += 3;
      else if (title.includes(t)) score += 2;
      else if (rest.includes(t)) score += 1;
      else return;
    }
    scored.push({ entry, score, i });
  });
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).slice(0, limit).map((s) => s.entry);
}
