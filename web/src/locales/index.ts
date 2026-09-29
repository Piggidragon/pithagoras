import { addLocale, apply, type Locale } from "../i18n";

/**
 * Every language in this folder, offered as it is found: a new one is a new
 * file here, and nothing else changes.
 */
const found = import.meta.glob<{ default: Locale }>("./*.ts", { eager: true });
for (const [file, mod] of Object.entries(found)) if (!file.endsWith("/index.ts")) addLocale(mod.default);
apply();
// Following the browser, it follows the browser's language changing too.
window.addEventListener("languagechange", apply);
