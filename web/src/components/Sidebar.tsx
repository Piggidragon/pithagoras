import { useState, type ReactNode } from "react";
import { confirmDialog } from "./ConfirmDialog";
import { TitleInput } from "./TitleInput";
import { ThemeSwitcher } from "./ThemeSwitcher";
import {
  LuBot,
  LuPanelLeftClose,
  LuPanelLeftOpen,
  LuPencil,
  LuClock,
  LuFolderKanban,
  LuGlobe,
  LuMessagesSquare,
  LuPin,
  LuPinOff,
  LuPlus,
  LuSettings,
  LuShield,
  LuTrash2,
} from "react-icons/lu";
import type { Session, SessionStatus } from "../api";

const STATUS_STYLE: Record<SessionStatus, string> = {
  running: "bg-accent animate-pulse",
  idle: "bg-fg-faint",
  error: "bg-danger",
  interrupted: "bg-warn",
};

const STATUS_LABEL: Record<SessionStatus, string> = {
  running: "running",
  idle: "idle",
  error: "error",
  interrupted: "interrupted — server restarted mid-run",
};

/** How many unpinned sessions the sidebar shows before deferring to Sessions. */
const RECENTS_LIMIT = 12;

export function Sidebar({
  sessions,
  executor,
  activeId,
  view,
  hasBrowser,
  onSelect,
  onNewChat,
  onDelete,
  onRename,
  onPin,
  onOpenSettings,
  onNavigate,
}: {
  sessions: Session[];
  executor: string;
  activeId: string | null;
  /** Which top-level destination is showing, so the nav can mark it. */
  view: "chat" | "sessions" | "projects" | "agent" | "routines" | "browser" | "audit";
  /** Whether the optional browser service is there at all. */
  hasBrowser: boolean;
  onSelect: (id: string) => void;
  /** A chat in Home, opened. */
  onNewChat: () => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onRename: (id: string, title: string) => Promise<void>;
  onPin: (id: string, pinned: boolean) => Promise<void>;
  onOpenSettings: () => void;
  onNavigate: (to: "sessions" | "projects" | "agent" | "routines" | "browser" | "audit") => void;
}) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("sidebarCollapsed") === "true");
  const toggleSidebar = () => {
    setCollapsed(value => {
      localStorage.setItem("sidebarCollapsed", String(!value));
      return !value;
    });
  };
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const newChat = async () => {
    if (starting) return;
    setStarting(true);
    setStartError(null);
    try {
      await onNewChat();
    } catch (e) {
      setStartError((e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const pinned = sessions.filter((s) => s.pinned);
  const recents = sessions.filter((s) => !s.pinned);
  const shownRecents = recents.slice(0, RECENTS_LIMIT);

  const item = (s: Session) => (
    <SessionItem
      key={s.id}
      session={s}
      active={activeId === s.id}
      onSelect={() => onSelect(s.id)}
      onRename={onRename}
      onDelete={onDelete}
      onPin={onPin}
    />
  );

  return (
    <aside aria-label="Sidebar" className={`relative flex shrink-0 flex-col overflow-hidden border-r border-line bg-surface transition-[width] duration-300 ease-in-out motion-reduce:transition-none ${collapsed ? "w-12" : "w-64"}`}>
      <button type="button" onClick={toggleSidebar} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} aria-controls="sidebar-content"
        className="absolute right-2 top-3 z-10 grid h-8 w-8 place-items-center rounded-lg text-fg-subtle transition-colors hover:bg-canvas hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
        {collapsed ? <LuPanelLeftOpen size={18} /> : <LuPanelLeftClose size={18} />}
      </button>
      <div id="sidebar-content" className={`min-h-0 w-64 flex-1 flex-col ${collapsed ? "hidden" : "flex"}`}>

      <div className="flex items-center gap-2 pl-3 pr-12 pb-3 pt-4">
        <img
          src="/logo-192.png"
          alt=""
          className="h-6 w-6 shrink-0 object-contain"
          draggable={false}
        />
        <h1 className="text-sm font-semibold tracking-tight text-fg">Pithagoras</h1>
        <span
          className="ml-auto text-[10px] uppercase tracking-wider text-fg-faint"
          title="How sessions are executed"
        >
          {executor}
        </span>
      </div>

      {/* Destinations, above the session lists. */}
      <nav className="px-2 pb-2">
        <NavItem icon={<LuPlus />} label="New" onClick={newChat} active={starting} />
        <NavItem
          icon={<LuMessagesSquare />}
          label="Sessions"
          onClick={() => onNavigate("sessions")}
          active={view === "sessions"}
        />
        <NavItem
          icon={<LuFolderKanban />}
          label="Projects"
          onClick={() => onNavigate("projects")}
          active={view === "projects"}
        />
        <NavItem
          icon={<LuBot />}
          label="Agent"
          onClick={() => onNavigate("agent")}
          active={view === "agent"}
        />
        <NavItem
          icon={<LuClock />}
          label="Routines"
          onClick={() => onNavigate("routines")}
          active={view === "routines"}
        />
        {/* Hidden unless there is one. The browser is an optional service, and
            a dead link to a feature you did not install is just clutter. */}
        {hasBrowser && (
          <NavItem
            icon={<LuGlobe />}
            label="Browser"
            onClick={() => onNavigate("browser")}
            active={view === "browser"}
          />
        )}
        <NavItem
          icon={<LuShield />}
          label="Audit"
          onClick={() => onNavigate("audit")}
          active={view === "audit"}
        />

        {startError && <p className="px-2.5 pt-1 text-xs text-danger">{startError}</p>}
      </nav>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {sessions.length === 0 && (
          <p className="px-2 py-4 text-xs text-fg-subtle">No sessions yet.</p>
        )}

        {pinned.length > 0 && (
          <>
            <Divider />
            <GroupLabel>Pinned</GroupLabel>
            {pinned.map(item)}
          </>
        )}

        {shownRecents.length > 0 && (
          <>
            <Divider />
            <GroupLabel>Recents</GroupLabel>
            {shownRecents.map(item)}
            {recents.length > shownRecents.length && (
              <button
                onClick={() => onNavigate("sessions")}
                className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-xs text-fg-subtle hover:bg-fg/5 hover:text-fg-muted"
              >
                {recents.length - shownRecents.length} more…
              </button>
            )}
          </>
        )}
      </div>

      <div className="border-t border-line p-2">
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <NavItem
              icon={<LuSettings />}
              label="Settings"
              onClick={onOpenSettings}
              active={false}
            />
          </div>
          <ThemeSwitcher />
        </div>
      </div>
      </div>
    </aside>
  );
}

const Divider = () => <div className="my-2 h-px bg-line" />;

const GroupLabel = ({ children }: { children: ReactNode }) => (
  <p className="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-fg-faint">
    {children}
  </p>
);

function NavItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`group relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition ${
        active ? "bg-fg/[0.07] text-fg" : "text-fg-muted hover:bg-fg/5 hover:text-fg"
      }`}
    >
      <span
        className={`absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r-full bg-accent transition-opacity ${
          active ? "opacity-100" : "opacity-0"
        }`}
      />
      <span className={`shrink-0 transition-colors ${active ? "text-accent" : "text-fg-faint group-hover:text-fg-subtle"}`}>
        {icon}
      </span>
      {label}
    </button>
  );
}

function SessionItem({
  session: s,
  active,
  onSelect,
  onRename,
  onDelete,
  onPin,
}: {
  session: Session;
  active: boolean;
  onSelect: () => void;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onPin: (id: string, pinned: boolean) => Promise<void>;
}) {
  const [renaming, setRenaming] = useState(false);
  return (
    <div
      onClick={onSelect}
      className={`group mb-0.5 cursor-pointer rounded-lg px-2.5 py-1.5 transition ${
        active ? "bg-fg/[0.07]" : "hover:bg-fg/5"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${STATUS_STYLE[s.status]}`}
          title={STATUS_LABEL[s.status]}
        />
        {renaming ? (
          <TitleInput
            value={s.title}
            label="Session name"
            className="flex-1 text-sm"
            onCommit={(next) => {
              setRenaming(false);
              onRename(s.id, next);
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <span
            className="truncate text-sm text-fg"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setRenaming(true);
            }}
          >
            {s.title}
          </span>
        )}

        <div className="ml-auto hidden shrink-0 items-center gap-0.5 group-hover:flex">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPin(s.id, !s.pinned);
            }}
            className="rounded p-1 text-fg-subtle hover:text-accent"
            title={s.pinned ? "Unpin" : "Pin"}
          >
            {s.pinned ? <LuPinOff className="h-3 w-3" /> : <LuPin className="h-3 w-3" />}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setRenaming(true);
            }}
            className="rounded p-1 text-fg-subtle hover:text-accent"
            title="Rename"
          >
            <LuPencil className="h-3 w-3" />
          </button>
          <button
            onClick={async (e) => {
              e.stopPropagation();
              if (
                await confirmDialog({
                  title: `Delete "${s.title}"?`,
                  message: "It is stopped if it is running, and its transcript is removed.",
                  confirmLabel: "Delete",
                  danger: true,
                  deletes: true,
                })
              ) {
                onDelete(s.id);
              }
            }}
            className="rounded p-1 text-fg-subtle hover:text-danger"
            title="Delete session"
          >
            <LuTrash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
      {/* Cut at the start, not the end: what tells chats apart is the last part of
          the path. rtl moves the ellipsis; bdi keeps the path itself left to right. */}
      <div className="truncate pl-4 text-left font-mono text-[10px] text-fg-subtle [direction:rtl]" title={s.workspace}>
        <bdi>{s.workspace}</bdi>
      </div>
    </div>
  );
}
