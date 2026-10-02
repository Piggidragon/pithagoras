import type { ReactNode } from "react";
import { LuBan, LuCircle, LuCircleCheck, LuCircleDot } from "react-icons/lu";
import type { ScreenBlock } from "../api";
import { isBlockType, itemsOf, toneOf, wordsOf, type BlockType, type CheckState, type Item, type Tone } from "../screens";
import { msg, t } from "../i18n";

/**
 * The building blocks of a screen, drawn: what an extension's data is shown
 * with. Generic on purpose — nothing here knows any extension, and what a
 * block takes is in screens.ts, with how to add one. A block that is not known
 * says so, and a block's data that it does not understand is left out.
 */

/** How deep blocks hold blocks as far as the page follows: the server stops them earlier. */
const DEPTH = 6;

const TONE: Record<Tone, string> = {
  ok: "text-ok",
  warn: "text-warn",
  error: "text-danger",
  muted: "text-fg-subtle",
};
const toneClass = (tone: Tone | undefined, otherwise = "text-fg") => (tone ? TONE[tone] : otherwise);

/** What a checklist's marks are, and what is said for them to one who cannot see them. */
const STATE: Record<CheckState, { Icon: typeof LuCircle; label: string; cls: string }> = {
  todo: { Icon: LuCircle, label: msg("To do"), cls: "text-fg-faint" },
  doing: { Icon: LuCircleDot, label: msg("In progress"), cls: "text-accent" },
  done: { Icon: LuCircleCheck, label: msg("Done"), cls: "text-ok" },
  blocked: { Icon: LuBan, label: msg("Waiting"), cls: "text-warn" },
};

type Props = { block: ScreenBlock; depth: number };

function Group({ block, depth }: Props) {
  const title = wordsOf(block.title);
  return (
    <section className={depth > 0 ? "space-y-2 border-l border-line pl-3" : "space-y-2"}>
      {title && <h4 className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">{title}</h4>}
      <Blocks blocks={block.blocks} depth={depth + 1} />
    </section>
  );
}

function Text({ block }: Props) {
  const text = wordsOf(block.text);
  if (text === undefined) return null;
  return <p className={`whitespace-pre-wrap break-words text-sm leading-relaxed ${toneClass(toneOf(block.tone))}`}>{text}</p>;
}

function Status({ block }: Props) {
  const text = wordsOf(block.text);
  if (text === undefined) return null;
  const label = wordsOf(block.label);
  const tone = toneOf(block.tone);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      {label && <span className="text-fg-subtle">{label}</span>}
      <span className={`inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-raised/55 px-2 py-0.5 ${toneClass(tone, "text-fg-muted")}`}>
        <i className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden />
        <span className="break-words">{text}</span>
      </span>
    </div>
  );
}

function Empty({ words }: { words: unknown }) {
  const text = wordsOf(words);
  return text ? <p className="text-xs text-fg-subtle">{text}</p> : null;
}

/**
 * The items of a list or a checklist, each with what it says apart from its
 * words, and the items it holds. `mark` draws what stands before an item, from
 * the item and its place in its own list.
 */
function Items({ items, mark, checks }: { items: Item[]; mark: (item: Item, index: number) => ReactNode; checks?: boolean }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="text-sm">
          <div className="flex items-start gap-2">
            {mark(item, i)}
            <div className="min-w-0 flex-1">
              <span className={`break-words ${checks && item.state === "done" ? "text-fg-subtle line-through" : toneClass(item.tone)}`}>{item.text}</span>
              {item.detail && <span className="ml-2 break-words text-xs text-fg-subtle">{item.detail}</span>}
            </div>
          </div>
          {item.items.length > 0 && (
            <div className="ml-2 mt-1.5 border-l border-line pl-3">
              <Items items={item.items} mark={mark} checks={checks} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function List({ block }: Props) {
  const items = itemsOf(block.items);
  if (!items.length) return <Empty words={block.empty} />;
  const ordered = block.ordered === true;
  return (
    <Items
      items={items}
      mark={(_, i) => (ordered ? <span className="w-5 shrink-0 text-right text-xs text-fg-subtle">{i + 1}.</span> : <i className="mt-2 h-1 w-1 shrink-0 rounded-full bg-fg-faint" aria-hidden />)}
    />
  );
}

function Checklist({ block }: Props) {
  const items = itemsOf(block.items);
  if (!items.length) return <Empty words={block.empty} />;
  return (
    <Items
      items={items}
      checks
      mark={({ state }) => {
        const { Icon, label, cls } = STATE[state];
        return (
          <span className={`mt-0.5 shrink-0 ${cls}`} title={t(label)}>
            <Icon className="h-3.5 w-3.5" aria-hidden />
            <span className="sr-only">{t(label)}</span>
          </span>
        );
      }}
    />
  );
}

/** The registry: each block type and what draws it. Typed over every type, so a new one cannot be left without. */
const BLOCKS: Record<BlockType, (props: Props) => ReactNode> = {
  group: Group,
  text: Text,
  status: Status,
  list: List,
  checklist: Checklist,
};

/** Blocks in a stack. What is not a list of blocks, or goes deeper than the page follows, is nothing. */
export function Blocks({ blocks, depth = 0 }: { blocks: unknown; depth?: number }) {
  if (!Array.isArray(blocks) || depth > DEPTH) return null;
  return (
    <>
      {blocks.map((block: ScreenBlock, i) => {
        if (!block || typeof block !== "object") return null;
        if (!isBlockType(block.type)) {
          return <p key={i} className="text-xs italic text-fg-faint">{t("Not a block this page knows: {type}", { type: String(block.type).slice(0, 40) })}</p>;
        }
        const Block = BLOCKS[block.type];
        return <Block key={i} block={block} depth={depth} />;
      })}
    </>
  );
}
