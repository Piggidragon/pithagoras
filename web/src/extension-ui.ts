/**
 * What an extension says without being asked.
 *
 * Three of pi's UI calls expect nowhere in particular to put them: setWidget
 * pins a block of text near the editor, setStatus a word in the footer, notify
 * says something once. The portal has delivered all three to the browser for as
 * long as extensions have worked here, and the page has dropped all three — so
 * rpiv-todo's task list and pi-web-access's activity line were drawn, sent, and
 * thrown away.
 *
 * Kept as a reducer so the rules are one place and can be read: which of them
 * replace, which accumulate, and what clears them.
 */

export type WidgetPlacement = "aboveEditor" | "belowEditor";

export interface ExtensionWidget {
  key: string;
  lines: string[];
  placement: WidgetPlacement;
}

export interface ExtensionStatus {
  key: string;
  text: string;
}

export interface ExtensionNotice {
  id: number;
  text: string;
  level: "info" | "warning" | "error";
}

export interface ExtensionUi {
  widgets: ExtensionWidget[];
  statuses: ExtensionStatus[];
  notices: ExtensionNotice[];
  /** Ids for notices. In the state so the reducer stays a function of what it is given. */
  counter: number;
}

export const NO_EXTENSION_UI: ExtensionUi = {
  widgets: [],
  statuses: [],
  notices: [],
  counter: 0,
};

/**
 * How many messages can be on screen at once.
 *
 * An extension in a loop can notify as fast as it likes, and a stack that grows
 * without end would cover the conversation it is talking about. The newest are
 * the ones kept: an older message has already had its moment.
 */
const MAX_NOTICES = 4;

/** One of pi's one-way UI calls, as the portal puts it on the event stream. */
export interface ExtensionUiRequest {
  method?: string;
  widgetKey?: string;
  widgetContent?: string[] | null;
  widgetPlacement?: string;
  statusKey?: string;
  statusText?: string;
  message?: string;
  notifyType?: string;
}

export function applyExtensionUi(state: ExtensionUi, request: ExtensionUiRequest): ExtensionUi {
  switch (request.method) {
    case "setWidget":
      return withWidget(state, request);
    case "setStatus":
      return withStatus(state, request);
    case "notify":
      return withNotice(state, request);
    default:
      // Dialogs, screens, titles — someone else's business. The same object
      // back, so a page full of them re-renders for none of them.
      return state;
  }
}

function withWidget(state: ExtensionUi, request: ExtensionUiRequest): ExtensionUi {
  const key = request.widgetKey;
  if (!key) return state;
  const lines = (request.widgetContent ?? []).filter((line) => typeof line === "string");
  // Trailing blank lines are a terminal's spacing, and in a page they are a gap
  // with a border around it.
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const rest = state.widgets.filter((w) => w.key !== key);
  if (!lines.length) {
    return rest.length === state.widgets.length ? state : { ...state, widgets: rest };
  }
  const placement: WidgetPlacement =
    request.widgetPlacement === "belowEditor" ? "belowEditor" : "aboveEditor";
  const at = state.widgets.findIndex((w) => w.key === key);
  const widget: ExtensionWidget = { key, lines, placement };
  if (at < 0) return { ...state, widgets: [...state.widgets, widget] };
  // Replaced where it already was: a widget that jumped to the end of the
  // stack every time it redrew would never sit still.
  const widgets = [...state.widgets];
  widgets[at] = widget;
  return { ...state, widgets };
}

function withStatus(state: ExtensionUi, request: ExtensionUiRequest): ExtensionUi {
  const key = request.statusKey;
  if (!key) return state;
  const text = (request.statusText ?? "").trim();
  const rest = state.statuses.filter((s) => s.key !== key);
  if (!text) {
    return rest.length === state.statuses.length ? state : { ...state, statuses: rest };
  }
  const at = state.statuses.findIndex((s) => s.key === key);
  if (at < 0) return { ...state, statuses: [...state.statuses, { key, text }] };
  const statuses = [...state.statuses];
  statuses[at] = { key, text };
  return { ...state, statuses };
}

function withNotice(state: ExtensionUi, request: ExtensionUiRequest): ExtensionUi {
  const text = (request.message ?? "").trim();
  if (!text) return state;
  const level: ExtensionNotice["level"] =
    request.notifyType === "error" ? "error" : request.notifyType === "warning" ? "warning" : "info";
  const id = state.counter + 1;
  return {
    ...state,
    counter: id,
    notices: [...state.notices, { id, text, level }].slice(-MAX_NOTICES),
  };
}

/** Read, or waited out. */
export function dismissNotice(state: ExtensionUi, id: number): ExtensionUi {
  const notices = state.notices.filter((n) => n.id !== id);
  return notices.length === state.notices.length ? state : { ...state, notices };
}
