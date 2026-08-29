/**
 * Same-browser multi-tab guard for one open project.
 *
 * BroadcastChannel tells other tabs a save landed. sessionStorage holds this
 * tab's id so we ignore our own echoes.
 */

export const TAB_SYNC_CHANNEL = "planform-iso-sync";
export const TAB_ID_KEY = "planform-iso:tab-id";

export type TabSyncMessage =
  | { type: "saved"; projectId: string; revision: number; tabId: string }
  | { type: "open"; projectId: string; tabId: string };

export function getTabId(): string {
  try {
    if (typeof sessionStorage === "undefined") return "tab_anon";
    let id = sessionStorage.getItem(TAB_ID_KEY);
    if (!id) {
      id = `tab_${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem(TAB_ID_KEY, id);
    }
    return id;
  } catch {
    return "tab_anon";
  }
}

export type TabSyncOutgoing =
  | { type: "saved"; projectId: string; revision: number }
  | { type: "open"; projectId: string };

export interface TabSyncHandle {
  tabId: string;
  post: (msg: TabSyncOutgoing) => void;
  close: () => void;
}

export function createTabSync(handlers: {
  onRemoteSave?: (msg: Extract<TabSyncMessage, { type: "saved" }>) => void;
  onPeerOpen?: (msg: Extract<TabSyncMessage, { type: "open" }>) => void;
}): TabSyncHandle {
  const tabId = getTabId();
  if (typeof BroadcastChannel === "undefined") {
    return { tabId, post: () => undefined, close: () => undefined };
  }
  const ch = new BroadcastChannel(TAB_SYNC_CHANNEL);
  ch.onmessage = (ev: MessageEvent<TabSyncMessage>) => {
    const msg = ev.data;
    if (!msg || msg.tabId === tabId) return;
    if (msg.type === "saved") handlers.onRemoteSave?.(msg);
    if (msg.type === "open") handlers.onPeerOpen?.(msg);
  };
  return {
    tabId,
    post: (msg) => {
      try {
        ch.postMessage({ ...msg, tabId });
      } catch {
        /* channel closed / unsupported */
      }
    },
    close: () => {
      try {
        ch.close();
      } catch {
        /* ignore */
      }
    },
  };
}
