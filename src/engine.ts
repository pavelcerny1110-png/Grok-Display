export const DISPLAY_TIME_ZONE = "Europe/Prague";
export const BACKEND_SCHEMA_VERSION = "1.0";

export type Item = {
  id: string;
  channel: string;
  type: string;
  title: string;
  subtitle: string;
  body: string;
  status: string;
  priority: number;
  sort: number;
  created_at: string;
  updated_at: string;
  expires_at: string;
  data_json: string;
};

export type CommandRecord = {
  command_id: string;
  action: string;
  target: unknown;
  payload: Record<string, unknown>;
  created_at: string;
  status: string;
  processed_at: string;
  error: string;
  result: unknown;
};

export type ArchiveRecord = Record<string, unknown> & { order_id: string; service_id: string };
export type EventRecord = Record<string, unknown> & { event_id: string; service_id: string };

export type DisplayState = {
  items: Item[];
  settings: Record<string, unknown>;
  commands: CommandRecord[];
  archive: ArchiveRecord[];
  events: EventRecord[];
  manualRevision: number;
  lastManualEventAt: string;
};

export type CommandInput = {
  command_id?: string;
  action?: string;
  target?: unknown;
  payload?: unknown;
  item?: unknown;
  items?: unknown;
};

const ITEM_FIELDS = [
  "id",
  "channel",
  "type",
  "title",
  "subtitle",
  "body",
  "status",
  "priority",
  "sort",
  "created_at",
  "updated_at",
  "expires_at",
  "data_json",
] as const;

const ACTION_ALIASES: Record<string, string> = {
  add_item: "upsert_item",
  create_item: "upsert_item",
  new_item: "upsert_item",
  add_items: "upsert_items",
  create_items: "upsert_items",
  update_item: "patch_item",
  edit_item: "patch_item",
  serve_order: "complete_order",
  finish_order: "complete_order",
  complete_operational: "complete_card",
  finish_card: "complete_card",
  remove_item: "delete_item",
  pin_card: "attach_card",
  unpin_card: "detach_card",
  partial_serve: "serve_order_items",
  issue_order_items: "serve_order_items",
  clear: "clear_display",
  undo_order: "reopen_order",
  reopen: "reopen_order",
  set_served_items: "set_order_item_states",
  update_order_items: "set_order_item_states",
  clear_today_log: "clear_current_service_log",
  clear_log: "clear_current_service_log",
  clear_everything_today: "clear_display_and_current_service_log",
};

export function emptyState(): DisplayState {
  return {
    items: [],
    settings: {
      theme: "dark",
      poll_seconds: 3,
      completed_visibility_seconds: 60,
      sound_enabled: true,
      active_channel: "main",
      screen_title: "Grok Display",
    },
    commands: [],
    archive: [],
    events: [],
    manualRevision: 0,
    lastManualEventAt: "",
  };
}

export function pragueServiceId(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DISPLAY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function pragueHHmm(date = new Date()): string {
  return new Intl.DateTimeFormat("cs-CZ", {
    timeZone: DISPLAY_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function nowIso(date = new Date()): string {
  return date.toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function finiteNumberOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value === undefined ? {} : value);
  } catch {
    return "{}";
  }
}

function parseDataObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return { ...(value as Record<string, unknown>) };
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeDataJsonCell(value: unknown): string {
  if (!value) return "{}";
  if (typeof value === "object") return safeJsonStringify(value);
  const text = String(value).trim();
  if (!text) return "{}";
  try {
    const parsed = JSON.parse(text);
    return safeJsonStringify(parsed && typeof parsed === "object" ? parsed : {});
  } catch {
    return text;
  }
}

function normalizeDateCell(value: unknown): string {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function stripCombiningMarks(value: unknown): string {
  const normalized = String(value || "").normalize("NFD");
  let out = "";
  for (let i = 0; i < normalized.length; i += 1) {
    const code = normalized.charCodeAt(i);
    if (code < 768 || code > 879) out += normalized.charAt(i);
  }
  return out;
}

function normalizeTextKey(value: unknown): string {
  return stripCombiningMarks(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function canonicalItemType(value: unknown): string {
  const normalized = normalizeTextKey(value).replace(/\s+/g, "_");
  const aliases: Record<string, string> = {
    objednavka: "order",
    order: "order",
    reminder: "reminder",
    pripominka: "reminder",
    tip: "tip",
    info: "info",
    informace: "info",
    alert: "alert",
    upozorneni: "alert",
  };
  return aliases[normalized] || String(value || "").trim().toLowerCase();
}

function isOperationalType(type: unknown): boolean {
  return ["reminder", "tip", "info", "alert"].includes(canonicalItemType(type));
}

function isCompletedLikeStatus(status: unknown): boolean {
  return ["completed", "done", "resolved", "closed", "hotovo"].includes(String(status || "").toLowerCase());
}

function isCancelledLikeStatus(status: unknown): boolean {
  return ["cancelled", "canceled", "zruseno", "zrušeno"].includes(String(status || "").toLowerCase());
}

function getMainOrderStatus(status: unknown): "waiting" | "completed" | "cancelled" {
  const value = String(status || "").toLowerCase();
  if (isCancelledLikeStatus(value)) return "cancelled";
  if (value === "served" || isCompletedLikeStatus(value)) return "completed";
  return "waiting";
}

function defaultStatusForType(type: string): string {
  return type === "order" ? "waiting" : "active";
}

function sanitizeIdPart(value: unknown): string {
  return (
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || String(Date.now())
  );
}

function nextSortValue(items: Item[]): number {
  return items.reduce((max, item) => Math.max(max, finiteNumberOr(item.sort, 0)), 0) + 1;
}

function normalizeItemRecord(item: Partial<Item> & Record<string, unknown>): Item {
  const result: Record<string, unknown> = {};
  for (const header of ITEM_FIELDS) {
    result[header] = item[header] == null ? "" : item[header];
  }
  result.id = String(result.id || "").trim();
  result.channel = String(result.channel || "main");
  result.type = String(result.type || "").trim().toLowerCase();
  result.title = String(result.title || "");
  result.subtitle = String(result.subtitle || "");
  result.body = String(result.body || "");
  result.status = String(result.status || "");
  result.priority = finiteNumberOr(result.priority, 0);
  result.sort = finiteNumberOr(result.sort, 0);
  result.created_at = normalizeDateCell(result.created_at);
  result.updated_at = normalizeDateCell(result.updated_at);
  result.expires_at = normalizeDateCell(result.expires_at);
  result.data_json = normalizeDataJsonCell(result.data_json);
  return result as Item;
}

function orderItemText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  const obj = value as Record<string, unknown>;
  return String(obj.text || obj.title || obj.name || obj.label || "").trim();
}

function stripOrderLineQuantity(value: unknown): string {
  return String(value || "")
    .replace(/^\s*\d+\s*[×x]\s*/i, "")
    .trim();
}

function normalizeOrderItemKey(value: unknown): string {
  return normalizeTextKey(
    stripOrderLineQuantity(value)
      .replace(/\s*\([^)]*\)\s*$/, "")
      .replace(/\s+[–—-]\s*\d+(?:[.,]\d+)?\s*kč\s*$/i, ""),
  );
}

function normalizeOrderItemStateKey(value: unknown): string {
  return normalizeTextKey(
    stripOrderLineQuantity(value)
      .replace(/\s*\(\s*\d+(?:[.,]\d+)?\s*kč\s*\)\s*$/i, "")
      .replace(/\s+[–—-]\s*\d+(?:[.,]\d+)?\s*kč\s*$/i, ""),
  );
}

function uniqueStrings(values: unknown[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  values
    .map(orderItemText)
    .filter(Boolean)
    .forEach((value) => {
      const key = normalizeOrderItemKey(value);
      if (!key || seen.has(key)) return;
      seen.add(key);
      result.push(value);
    });
  return result;
}

function getPendingOrderItems(item: Item, data: Record<string, unknown>): string[] {
  if (Object.prototype.hasOwnProperty.call(data, "pending_items") && Array.isArray(data.pending_items)) {
    return data.pending_items.map(orderItemText).filter(Boolean);
  }
  if (Array.isArray(data.items)) {
    const pending = data.items
      .filter((value) => {
        if (!value || typeof value !== "object") return true;
        const status = String((value as { status?: unknown }).status || "").toLowerCase();
        return !isCompletedLikeStatus(status) && status !== "served";
      })
      .map(orderItemText)
      .filter(Boolean);
    if (pending.length) return pending;
  }
  return String(item.body || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map(stripOrderLineQuantity)
    .filter(Boolean);
}

function getServedOrderItems(data: Record<string, unknown>): string[] {
  if (Array.isArray(data.served_items)) return data.served_items.map(orderItemText).filter(Boolean);
  if (Array.isArray(data.items)) {
    return data.items
      .filter((value) => {
        if (!value || typeof value !== "object") return false;
        const status = String((value as { status?: unknown }).status || "").toLowerCase();
        return status === "served" || isCompletedLikeStatus(status);
      })
      .map(orderItemText)
      .filter(Boolean);
  }
  return [];
}

function getAllOrderItems(item: Item, data: Record<string, unknown>): string[] {
  const values: string[] = [];
  const bodyValues = String(item.body || "")
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean)
    .map(stripOrderLineQuantity)
    .filter(Boolean);
  values.push(...bodyValues);
  if (Array.isArray(data.pending_items)) values.push(...data.pending_items.map(orderItemText));
  if (Array.isArray(data.served_items)) values.push(...data.served_items.map(orderItemText));
  const byKey = new Map<string, string>();
  values.forEach((value) => {
    const text = orderItemText(value);
    const key = normalizeOrderItemStateKey(text);
    if (key && !byKey.has(key)) byKey.set(key, text);
  });
  return Array.from(byKey.values());
}

function sameStringSet(a: unknown[], b: unknown[]): boolean {
  const first = Array.from(new Set((Array.isArray(a) ? a : []).map(normalizeOrderItemStateKey).filter(Boolean))).sort();
  const second = Array.from(new Set((Array.isArray(b) ? b : []).map(normalizeOrderItemStateKey).filter(Boolean))).sort();
  return first.length === second.length && first.every((value, index) => value === second[index]);
}

function ensureOrderItemStateArrays(item: Item, data: Record<string, unknown>): void {
  if (!Array.isArray(data.served_items)) data.served_items = [];
  const shouldDerive =
    !Array.isArray(data.pending_items) ||
    (data.pending_items.length === 0 && (data.served_items as unknown[]).length === 0 && String(item.body || "").trim());
  if (shouldDerive) {
    data.pending_items = String(item.body || "")
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean)
      .map(stripOrderLineQuantity)
      .filter(Boolean);
  }
  data.served_items = uniqueStrings(data.served_items as unknown[]);
  data.pending_items = uniqueStrings((data.pending_items as unknown[]) || []);
}

function getParentOrderId(item: Item): string {
  const data = parseDataObject(item.data_json);
  return String(
    data.parent_order_id ||
      data.parentOrderId ||
      data.pinned_to_order_id ||
      data.pinnedToOrderId ||
      data.attached_to_order_id ||
      data.attachedToOrderId ||
      data.order_id ||
      data.orderId ||
      "",
  ).trim();
}

function stripOrderReceiptSubtitlePrefix(value: unknown): string {
  return String(value || "")
    .replace(/^\s*Přijato\s+v\s+\d{1,2}:\d{2}\s*(?:[·•|—–-]\s*)?/i, "")
    .trim();
}

function buildOrderReceiptSubtitle(subtitle: unknown, data: Record<string, unknown>, iso: string): string {
  let context = stripOrderReceiptSubtitlePrefix(subtitle);
  if (!context) {
    context = String(
      data.table ||
        data.table_name ||
        data.tableName ||
        data.customer ||
        data.customer_name ||
        data.customerName ||
        data.person ||
        data.name ||
        data.customer_or_table ||
        data.customerOrTable ||
        "",
    ).trim();
  }
  const receivedLabel = "Přijato v " + pragueHHmm(new Date(iso));
  return context ? receivedLabel + " · " + context : receivedLabel;
}

function extractOrderNumber(item: Item): number | null {
  const data = parseDataObject(item.data_json);
  const candidates = [
    data.order_number,
    data.orderNumber,
    data.display_order_number,
    data.displayOrderNumber,
    data.operational_number,
    data.operationalNumber,
    data.provozni_cislo,
    data.cislo_objednavky,
    data.number,
  ];
  for (const value of candidates) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  const fallback = Number(item.sort);
  return Number.isFinite(fallback) ? fallback : null;
}

function canonicalCommandAction(value: unknown): string {
  const action = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return ACTION_ALIASES[action] || action;
}

function isPendingCommandStatus(status: unknown): boolean {
  const value = String(status || "").trim().toLowerCase();
  return value === "" || value === "pending" || value === "queued" || value === "new";
}

function isOrderLogClearAction(action: string): boolean {
  return (
    action === "clear_current_service_log" ||
    action === "clear_all_order_logs" ||
    action === "clear_display_and_current_service_log"
  );
}

function normalizeExpectedTypes(value: unknown): string[] {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean);
}

function normalizeSelector(selector: unknown): { id: string; orderNumber: number | null; title: string } {
  if (selector && typeof selector === "object" && !Array.isArray(selector)) {
    const obj = selector as Record<string, unknown>;
    const id = String(obj.id || obj.item_id || obj.itemId || "").trim();
    const rawOrderNumber =
      obj.order_number !== undefined
        ? obj.order_number
        : obj.orderNumber !== undefined
          ? obj.orderNumber
          : obj.number !== undefined
            ? obj.number
            : null;
    const orderNumber = rawOrderNumber === null || rawOrderNumber === "" ? null : Number(rawOrderNumber);
    const title = String(obj.title || obj.name || "").trim();
    return { id, orderNumber: Number.isFinite(orderNumber as number) ? (orderNumber as number) : null, title };
  }
  const value = String(selector ?? "").trim();
  if (!value) return { id: "", orderNumber: null, title: "" };
  if (/^\d+$/.test(value)) return { id: "", orderNumber: Number(value), title: "" };
  if (/^(order|info|tip|alert|reminder|item)-/i.test(value)) return { id: value, orderNumber: null, title: "" };
  return { id: "", orderNumber: null, title: value };
}

function selectorDescription(selector: unknown): string {
  if (selector && typeof selector === "object") return safeJsonStringify(selector);
  return String(selector ?? "");
}

function resolveSingleItemIndex(
  items: Item[],
  selector: unknown,
  options: { expectedTypes?: unknown; allowFuzzy?: boolean; allowMissing?: boolean } = {},
): number {
  const expectedTypes = normalizeExpectedTypes(options.expectedTypes);
  const filtered = items
    .map((item, index) => ({ item, index }))
    .filter((entry) => !expectedTypes.length || expectedTypes.includes(String(entry.item.type || "").toLowerCase()));

  if (!(selector && typeof selector === "object")) {
    const directId = String(selector ?? "").trim();
    if (directId) {
      const directMatches = filtered.filter((entry) => String(entry.item.id || "") === directId);
      if (directMatches.length === 1) return directMatches[0].index;
      if (directMatches.length > 1) throw new Error("Cíl není jednoznačný (" + directMatches.length + " shod): " + directId);
    }
  }

  const normalized = normalizeSelector(selector);
  let matches: typeof filtered = [];
  if (normalized.id) {
    matches = filtered.filter((entry) => String(entry.item.id || "") === normalized.id);
  } else if (normalized.orderNumber !== null) {
    matches = filtered.filter(
      (entry) => String(entry.item.type || "").toLowerCase() === "order" && extractOrderNumber(entry.item) === normalized.orderNumber,
    );
  } else if (normalized.title) {
    const wanted = normalizeTextKey(normalized.title);
    matches = filtered.filter((entry) => normalizeTextKey(entry.item.title) === wanted);
    if (!matches.length && options.allowFuzzy) {
      matches = filtered.filter((entry) => {
        const current = normalizeTextKey(entry.item.title);
        return current && wanted && (current.includes(wanted) || wanted.includes(current));
      });
    }
  }

  if (!matches.length) {
    if (options.allowMissing) return -1;
    throw new Error("Cílová položka nebyla nalezena: " + selectorDescription(selector));
  }
  if (matches.length > 1) {
    throw new Error("Cíl není jednoznačný (" + matches.length + " shod): " + selectorDescription(selector));
  }
  return matches[0].index;
}

function createOrderCompletionUndoSnapshot(items: Item[], orderIndex: number) {
  const order = items[orderIndex] || ({} as Item);
  const data = parseDataObject(order.data_json);
  const cleanData = { ...data };
  delete cleanData._completion_undo;
  const children = items
    .filter((item) => isOperationalType(item.type) && getParentOrderId(item) === String(order.id || ""))
    .map((item) => ({
      id: String(item.id || ""),
      status: String(item.status || ""),
      data_json: normalizeDataJsonCell(item.data_json),
    }));
  return {
    order: { status: String(order.status || "waiting"), data_json: safeJsonStringify(cleanData) },
    children,
    completed_child_ids: [] as string[],
  };
}

function completeCardAtIndex(items: Item[], index: number, iso: string, completedByParent: boolean) {
  const item = { ...items[index] };
  const data = parseDataObject(item.data_json);
  if (isCompletedLikeStatus(item.status) || String(item.status || "").toLowerCase() === "served") {
    return { changed: false, itemId: item.id, status: "completed" };
  }
  data.completed_at = iso;
  if (completedByParent) data.completed_by_parent = true;
  else delete data.completed_by_parent;
  item.status = "completed";
  item.updated_at = iso;
  item.data_json = safeJsonStringify(data);
  items[index] = normalizeItemRecord(item);
  return { changed: true, itemId: item.id, status: "completed" };
}

function completeActiveChildrenForOrder(items: Item[], orderId: string, iso: string): string[] {
  const completed: string[] = [];
  items.forEach((item, index) => {
    if (!isOperationalType(item.type)) return;
    if (getParentOrderId(item) !== String(orderId || "")) return;
    if (isCompletedLikeStatus(item.status) || isCancelledLikeStatus(item.status) || String(item.status || "").toLowerCase() === "served")
      return;
    completeCardAtIndex(items, index, iso, true);
    completed.push(String(items[index].id || ""));
  });
  return completed.filter(Boolean);
}

function completeOrderAtIndex(items: Item[], index: number, iso: string, options?: { undoSnapshot?: ReturnType<typeof createOrderCompletionUndoSnapshot> }) {
  const item = { ...items[index] };
  const data = parseDataObject(item.data_json);
  const pending = getPendingOrderItems(item, data);
  const currentStatus = String(item.status || "").toLowerCase();
  if ((currentStatus === "served" || isCompletedLikeStatus(currentStatus)) && pending.length === 0) {
    return { changed: false, itemId: item.id, status: "served", completedChildIds: [] as string[] };
  }
  const undoSnapshot = options?.undoSnapshot || createOrderCompletionUndoSnapshot(items, index);
  const served = getServedOrderItems(data);
  data.served_items = uniqueStrings(served.concat(pending));
  data.pending_items = [];
  data.served_at = iso;
  data.completed_at = iso;
  data._completion_undo = undoSnapshot;
  item.status = "served";
  item.updated_at = iso;
  item.data_json = safeJsonStringify(data);
  items[index] = normalizeItemRecord(item);
  const completedChildren = completeActiveChildrenForOrder(items, item.id, iso);
  const finalData = parseDataObject(items[index].data_json);
  if (finalData._completion_undo && typeof finalData._completion_undo === "object") {
    (finalData._completion_undo as { completed_child_ids: string[] }).completed_child_ids = completedChildren.slice();
    items[index].data_json = safeJsonStringify(finalData);
  }
  return { changed: true, itemId: item.id, status: "served", completedChildIds: completedChildren };
}

function reopenOrderAtIndex(items: Item[], index: number, iso: string) {
  const item = { ...items[index] };
  const data = parseDataObject(item.data_json);
  const snapshot = data._completion_undo && typeof data._completion_undo === "object" ? (data._completion_undo as Record<string, unknown>) : null;
  if (getMainOrderStatus(item.status) === "waiting") {
    return { changed: false, itemId: item.id, status: "waiting", restoredChildIds: [] as string[] };
  }
  let restoredData: Record<string, unknown>;
  let restoredStatus = "waiting";
  const restoredChildIds: string[] = [];
  if (snapshot && snapshot.order && typeof snapshot.order === "object") {
    const snapOrder = snapshot.order as { status?: string; data_json?: unknown };
    restoredStatus = String(snapOrder.status || "waiting");
    restoredData = parseDataObject(snapOrder.data_json);
    const completedChildIds = new Set(
      Array.isArray(snapshot.completed_child_ids) ? snapshot.completed_child_ids.map(String) : [],
    );
    const childSnapshots = Array.isArray(snapshot.children) ? snapshot.children : [];
    childSnapshots.forEach((childSnapshot) => {
      const snap = childSnapshot as { id?: string; status?: string; data_json?: unknown };
      const childId = String(snap?.id || "");
      if (!childId || !completedChildIds.has(childId)) return;
      const childIndex = items.findIndex((value) => String(value.id || "") === childId);
      if (childIndex < 0) return;
      const currentChildData = parseDataObject(items[childIndex].data_json);
      if (!currentChildData.completed_by_parent) return;
      items[childIndex] = normalizeItemRecord({
        ...items[childIndex],
        status: String(snap.status || "active"),
        data_json: normalizeDataJsonCell(snap.data_json),
        updated_at: iso,
      });
      restoredChildIds.push(childId);
    });
  } else {
    restoredData = { ...data };
    restoredData.served_items = [];
    restoredData.pending_items = getAllOrderItems(item, restoredData);
  }
  delete restoredData.served_at;
  delete restoredData.completed_at;
  delete restoredData.cancelled_at;
  delete restoredData.canceled_at;
  delete restoredData._completion_undo;
  item.status = restoredStatus;
  item.updated_at = iso;
  item.data_json = safeJsonStringify(restoredData);
  items[index] = normalizeItemRecord(item);
  return { changed: true, itemId: item.id, status: "waiting", restoredChildIds };
}

function cancelOrderAtIndex(items: Item[], index: number, iso: string) {
  const item = { ...items[index] };
  const data = parseDataObject(item.data_json);
  if (isCancelledLikeStatus(item.status)) {
    return { changed: false, itemId: item.id, status: "cancelled", completedChildIds: [] as string[] };
  }
  data.cancelled_at = iso;
  item.status = "cancelled";
  item.updated_at = iso;
  item.data_json = safeJsonStringify(data);
  items[index] = normalizeItemRecord(item);
  const completedChildren = completeActiveChildrenForOrder(items, item.id, iso);
  return { changed: true, itemId: item.id, status: "cancelled", completedChildIds: completedChildren };
}

function upsertOneItem(
  items: Item[],
  source: Record<string, unknown>,
  fallbackId: string,
  iso: string,
  activeChannel: string,
) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("upsert_item vyžaduje objekt payload.item.");
  }
  const requestedId = String(source.id || "").trim();
  const itemId = requestedId || "item-" + sanitizeIdPart(fallbackId);
  const existingIndex = items.findIndex((item) => String(item.id || "") === itemId);
  const existing = existingIndex >= 0 ? items[existingIndex] : ({} as Partial<Item>);
  const merged = { ...existing, ...source, id: itemId } as Record<string, unknown>;
  if (!merged.type) throw new Error("Nová položka musí mít type.");
  const type = String(merged.type).trim().toLowerCase();
  merged.type = type;
  merged.channel = String(merged.channel || activeChannel || "main");
  merged.title = String(merged.title || "");
  merged.subtitle = String(merged.subtitle || "");
  merged.body = String(merged.body || "");
  merged.status = String(merged.status || defaultStatusForType(type));
  merged.priority = finiteNumberOr(merged.priority, 0);
  merged.sort = finiteNumberOr(merged.sort, nextSortValue(items));
  if (type === "order" && existingIndex < 0) {
    merged.created_at = iso;
    merged.updated_at = iso;
  } else {
    merged.created_at = Object.prototype.hasOwnProperty.call(source, "created_at")
      ? normalizeDateCell(source.created_at) || existing.created_at || iso
      : existing.created_at || iso;
    merged.updated_at = Object.prototype.hasOwnProperty.call(source, "updated_at")
      ? normalizeDateCell(source.updated_at) || iso
      : iso;
  }
  merged.expires_at = normalizeDateCell(merged.expires_at);
  if (Object.prototype.hasOwnProperty.call(source, "data") && !Object.prototype.hasOwnProperty.call(source, "data_json")) {
    merged.data_json = source.data;
  }
  merged.data_json = normalizeDataJsonCell(merged.data_json);
  if (type === "order") {
    const orderData = parseDataObject(merged.data_json);
    if (existingIndex < 0) {
      orderData.received_at = iso;
      orderData.service_id = pragueServiceId(new Date(iso));
      merged.subtitle = buildOrderReceiptSubtitle(merged.subtitle, orderData, iso);
    }
    const asItem = normalizeItemRecord(merged);
    ensureOrderItemStateArrays(asItem, orderData);
    merged.data_json = safeJsonStringify(orderData);
  }
  const normalized = normalizeItemRecord(merged);
  if (existingIndex >= 0) items[existingIndex] = normalized;
  else items.push(normalized);
  return { changed: true, itemId, operation: existingIndex >= 0 ? "updated" : "created" };
}

function normalizeRequestedItems(source: unknown): { name: string; quantity: number }[] {
  const values = Array.isArray(source) ? source : source ? [source] : [];
  return values
    .map((value) => {
      if (typeof value === "string") {
        const match = value.trim().match(/^(\d+)\s*[×x]\s*(.+)$/i);
        return match
          ? { name: match[2].trim(), quantity: Math.max(1, Number(match[1]) || 1) }
          : { name: value.trim(), quantity: 1 };
      }
      if (value && typeof value === "object") {
        const obj = value as Record<string, unknown>;
        return {
          name: String(obj.name || obj.text || obj.title || "").trim(),
          quantity: Math.max(1, Number(obj.quantity || obj.qty || 1) || 1),
        };
      }
      return { name: "", quantity: 0 };
    })
    .filter((value) => value.name && value.quantity > 0);
}

function findRequestedOrderItemIndex(pending: string[], requestedName: string): number {
  const wanted = normalizeOrderItemKey(requestedName);
  const exact: number[] = [];
  const fuzzy: number[] = [];
  pending.forEach((value, index) => {
    const current = normalizeOrderItemKey(value);
    if (current === wanted) exact.push(index);
    else if (current && wanted && (current.includes(wanted) || wanted.includes(current))) fuzzy.push(index);
  });
  if (exact.length >= 1) return exact[0];
  if (fuzzy.length === 1) return fuzzy[0];
  return -1;
}

type CommandResult = Record<string, unknown> & { changed?: boolean; skipOrderAudit?: boolean };

function applyCommandToItems(
  items: Item[],
  command: { action: string; target: unknown; commandId: string },
  payload: Record<string, unknown>,
  iso: string,
  activeChannel: string,
  state: DisplayState,
): CommandResult {
  const action = canonicalCommandAction(command.action);
  switch (action) {
    case "upsert_item":
      return upsertOneItem(items, (payload.item || payload) as Record<string, unknown>, command.commandId, iso, activeChannel);
    case "upsert_items": {
      const source = Array.isArray(payload.items) ? payload.items : [];
      if (!source.length) throw new Error("upsert_items vyžaduje neprázdné pole payload.items.");
      const ids: string[] = [];
      let changed = false;
      source.forEach((item, index) => {
        const result = upsertOneItem(items, item as Record<string, unknown>, command.commandId + "-" + (index + 1), iso, activeChannel);
        ids.push(result.itemId);
        changed = changed || result.changed;
      });
      return { changed, itemIds: ids };
    }
    case "patch_item": {
      const selector = payload.selector || payload.target || command.target;
      const index = resolveSingleItemIndex(items, selector, {
        expectedTypes: payload.expected_types || payload.expectedTypes || payload.expected_type || payload.expectedType,
        allowFuzzy: Boolean(payload.allow_fuzzy || payload.allowFuzzy),
      });
      const patch = (payload.patch || payload.fields) as Record<string, unknown> | undefined;
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("patch_item vyžaduje objekt payload.patch.");
      const item = { ...items[index] } as Record<string, unknown>;
      const allowed = new Set(ITEM_FIELDS);
      Object.keys(patch).forEach((key) => {
        if (!allowed.has(key as (typeof ITEM_FIELDS)[number])) return;
        item[key] = patch[key];
      });
      if (patch.data_json && typeof patch.data_json === "object") item.data_json = safeJsonStringify(patch.data_json);
      const dataPatch = (payload.data_json_patch || payload.dataJsonPatch) as Record<string, unknown> | undefined;
      if (dataPatch && typeof dataPatch === "object" && !Array.isArray(dataPatch)) {
        const data = parseDataObject(item.data_json);
        Object.keys(dataPatch).forEach((key) => {
          if (dataPatch[key] === null) delete data[key];
          else data[key] = dataPatch[key];
        });
        item.data_json = safeJsonStringify(data);
      }
      const clearFields = Array.isArray(payload.clear_fields) ? payload.clear_fields : [];
      clearFields.forEach((key) => {
        if (allowed.has(key as (typeof ITEM_FIELDS)[number]) && key !== "id") item[String(key)] = "";
      });
      item.updated_at = normalizeDateCell(patch.updated_at) || iso;
      items[index] = normalizeItemRecord(item);
      return { changed: true, itemId: items[index].id };
    }
    case "set_status": {
      const selector = payload.selector || payload.target || command.target;
      const index = resolveSingleItemIndex(items, selector, {
        expectedTypes: payload.expected_types || payload.expectedTypes,
        allowFuzzy: Boolean(payload.allow_fuzzy || payload.allowFuzzy),
      });
      const status = String(payload.status || "").trim().toLowerCase();
      if (!status) throw new Error("set_status vyžaduje payload.status.");
      const type = String(items[index].type || "").toLowerCase();
      if (type === "order") {
        if (isCompletedLikeStatus(status) || status === "served") return completeOrderAtIndex(items, index, iso);
        if (isCancelledLikeStatus(status)) return cancelOrderAtIndex(items, index, iso);
      }
      if (isOperationalType(type) && (isCompletedLikeStatus(status) || status === "served")) {
        return completeCardAtIndex(items, index, iso, false);
      }
      const item = { ...items[index] };
      const data = parseDataObject(item.data_json);
      item.status = status;
      item.updated_at = iso;
      if (status === "waiting" || status === "active") {
        delete data.served_at;
        delete data.cancelled_at;
        delete data.canceled_at;
        delete data.completed_at;
        delete data.completed_by_parent;
      }
      item.data_json = safeJsonStringify(data);
      items[index] = normalizeItemRecord(item);
      return { changed: true, itemId: item.id, status };
    }
    case "complete_order":
      return completeOrderAtIndex(
        items,
        resolveSingleItemIndex(items, payload.selector || payload.target || command.target, { expectedTypes: ["order"] }),
        iso,
      );
    case "reopen_order":
      return reopenOrderAtIndex(
        items,
        resolveSingleItemIndex(items, payload.selector || payload.target || command.target, { expectedTypes: ["order"] }),
        iso,
      );
    case "cancel_order":
      return cancelOrderAtIndex(
        items,
        resolveSingleItemIndex(items, payload.selector || payload.target || command.target, { expectedTypes: ["order"] }),
        iso,
      );
    case "set_order_item_states": {
      const index = resolveSingleItemIndex(items, payload.selector || payload.target || command.target, { expectedTypes: ["order"] });
      const item = { ...items[index] };
      if (getMainOrderStatus(item.status) !== "waiting") {
        throw new Error("Jednotlivé položky lze měnit jen u čekající objednávky.");
      }
      const data = parseDataObject(item.data_json);
      const allItems = getAllOrderItems(item, data);
      const requested = Array.isArray(payload.served_items)
        ? payload.served_items
        : Array.isArray(payload.servedItems)
          ? payload.servedItems
          : [];
      const selectedKeys = new Set(requested.map(normalizeOrderItemStateKey).filter(Boolean));
      const nextServed: string[] = [];
      const nextPending: string[] = [];
      allItems.forEach((value) => {
        if (selectedKeys.has(normalizeOrderItemStateKey(value))) nextServed.push(value);
        else nextPending.push(value);
      });
      const previousServed = getServedOrderItems(data);
      const previousPending = getPendingOrderItems(item, data);
      if (sameStringSet(previousServed, nextServed) && sameStringSet(previousPending, nextPending)) {
        return { changed: false, itemId: item.id, status: "waiting" };
      }
      const undoSnapshot = createOrderCompletionUndoSnapshot(items, index);
      data.served_items = uniqueStrings(nextServed);
      data.pending_items = uniqueStrings(nextPending);
      item.updated_at = iso;
      item.data_json = safeJsonStringify(data);
      items[index] = normalizeItemRecord(item);
      if (!nextPending.length && payload.complete_when_empty !== false && payload.completeWhenEmpty !== false) {
        return completeOrderAtIndex(items, index, iso, { undoSnapshot });
      }
      return { changed: true, itemId: item.id, status: "waiting", servedItems: nextServed, remainingItems: nextPending };
    }
    case "serve_order_items": {
      const index = resolveSingleItemIndex(items, payload.selector || payload.target || command.target, { expectedTypes: ["order"] });
      const requested = normalizeRequestedItems(payload.items || payload.served_items || payload.servedItems);
      if (!requested.length) throw new Error("serve_order_items vyžaduje payload.items.");
      const item = { ...items[index] };
      const undoSnapshot = createOrderCompletionUndoSnapshot(items, index);
      const data = parseDataObject(item.data_json);
      const pending = getPendingOrderItems(item, data);
      const served = getServedOrderItems(data);
      const workingPending = pending.slice();
      const newlyServed: string[] = [];
      requested.forEach((request) => {
        for (let count = 0; count < request.quantity; count += 1) {
          const matchIndex = findRequestedOrderItemIndex(workingPending, request.name);
          if (matchIndex < 0) throw new Error("Položka nebyla v čekající části objednávky nalezena: " + request.name);
          newlyServed.push(workingPending[matchIndex]);
          workingPending.splice(matchIndex, 1);
        }
      });
      data.served_items = uniqueStrings(served.concat(newlyServed));
      data.pending_items = workingPending;
      item.updated_at = iso;
      item.data_json = safeJsonStringify(data);
      items[index] = normalizeItemRecord(item);
      if (!workingPending.length && payload.complete_when_empty !== false && payload.completeWhenEmpty !== false) {
        return completeOrderAtIndex(items, index, iso, { undoSnapshot });
      }
      return { changed: true, itemId: item.id, servedItems: newlyServed, remainingItems: workingPending };
    }
    case "complete_card":
      return completeCardAtIndex(
        items,
        resolveSingleItemIndex(items, payload.selector || payload.target || command.target, {
          expectedTypes: ["reminder", "tip", "info", "alert"],
          allowFuzzy: Boolean(payload.allow_fuzzy || payload.allowFuzzy),
        }),
        iso,
        false,
      );
    case "delete_item": {
      const selector = payload.selector || payload.target || command.target;
      const allowMissing = Boolean(payload.allow_missing || payload.allowMissing);
      const index = resolveSingleItemIndex(items, selector, {
        expectedTypes: payload.expected_types || payload.expectedTypes,
        allowFuzzy: Boolean(payload.allow_fuzzy || payload.allowFuzzy),
        allowMissing,
      });
      if (index < 0) return { changed: false, itemId: "", missing: true };
      const removed = items.splice(index, 1)[0];
      if (String(removed.type || "").toLowerCase() === "order") {
        for (let i = items.length - 1; i >= 0; i -= 1) {
          if (getParentOrderId(items[i]) === String(removed.id || "")) items.splice(i, 1);
        }
      }
      return { changed: true, itemId: removed.id };
    }
    case "attach_card": {
      const cardSelector = payload.card_selector || payload.cardSelector || payload.selector || command.target;
      const orderSelector =
        payload.parent_order_selector ||
        payload.parentOrderSelector ||
        payload.parent_order_id ||
        payload.parentOrderId ||
        payload.order_selector ||
        payload.orderSelector;
      if (!orderSelector) throw new Error("attach_card vyžaduje parent_order_selector nebo parent_order_id.");
      const cardIndex = resolveSingleItemIndex(items, cardSelector, {
        expectedTypes: ["reminder", "tip", "info", "alert"],
        allowFuzzy: Boolean(payload.allow_fuzzy || payload.allowFuzzy),
      });
      const orderIndex = resolveSingleItemIndex(items, orderSelector, { expectedTypes: ["order"] });
      const card = { ...items[cardIndex] };
      const data = parseDataObject(card.data_json);
      const nextParentId = String(items[orderIndex].id || "");
      if (getParentOrderId(card) === nextParentId) return { changed: false, itemId: card.id, parentOrderId: nextParentId };
      data.parent_order_id = nextParentId;
      card.data_json = safeJsonStringify(data);
      card.updated_at = iso;
      items[cardIndex] = normalizeItemRecord(card);
      return { changed: true, itemId: card.id, parentOrderId: data.parent_order_id };
    }
    case "detach_card": {
      const cardIndex = resolveSingleItemIndex(items, payload.selector || payload.target || command.target, {
        expectedTypes: ["reminder", "tip", "info", "alert"],
        allowFuzzy: Boolean(payload.allow_fuzzy || payload.allowFuzzy),
      });
      const card = { ...items[cardIndex] };
      const data = parseDataObject(card.data_json);
      if (!getParentOrderId(card)) return { changed: false, itemId: card.id };
      delete data.parent_order_id;
      delete data.parentOrderId;
      delete data.pinned_to_order_id;
      delete data.pinnedToOrderId;
      delete data.attached_to_order_id;
      delete data.attachedToOrderId;
      delete data.order_id;
      delete data.orderId;
      card.data_json = safeJsonStringify(data);
      card.updated_at = iso;
      items[cardIndex] = normalizeItemRecord(card);
      return { changed: true, itemId: card.id };
    }
    case "clear_display": {
      const channel = String(payload.channel || command.target || "").trim();
      if (channel && channel !== "*" && channel.toLowerCase() !== "all") {
        const before = items.length;
        for (let i = items.length - 1; i >= 0; i -= 1) {
          if (String(items[i].channel || activeChannel || "main") === channel) items.splice(i, 1);
        }
        return { changed: before !== items.length, cleared: before - items.length, channel };
      }
      const cleared = items.length;
      items.splice(0, items.length);
      return { changed: cleared > 0, cleared, channel: "all" };
    }
    case "clear_channel": {
      const channel = String(payload.channel || command.target || activeChannel || "main").trim();
      const before = items.length;
      for (let i = items.length - 1; i >= 0; i -= 1) {
        if (String(items[i].channel || "main") === channel) items.splice(i, 1);
      }
      return { changed: before !== items.length, cleared: before - items.length, channel };
    }
    case "clear_current_service_log": {
      const serviceId = String(payload.service_id || payload.serviceId || pragueServiceId(new Date(iso)));
      const beforeA = state.archive.length;
      const beforeE = state.events.length;
      state.archive = state.archive.filter((record) => String(record.service_id || "") !== serviceId);
      state.events = state.events.filter((record) => String(record.service_id || "") !== serviceId);
      return {
        changed: false,
        skipOrderAudit: true,
        serviceId,
        clearedArchiveOrders: beforeA - state.archive.length,
        clearedEvents: beforeE - state.events.length,
      };
    }
    case "clear_all_order_logs": {
      if (!(payload.confirm === true || payload.confirm_all === true || payload.confirmAll === true)) {
        throw new Error("clear_all_order_logs vyžaduje explicitní payload.confirm = true.");
      }
      const archiveCount = state.archive.length;
      const eventCount = state.events.length;
      state.archive = [];
      state.events = [];
      return { changed: false, skipOrderAudit: true, clearedArchiveOrders: archiveCount, clearedEvents: eventCount, clearedAt: iso };
    }
    case "clear_display_and_current_service_log": {
      const clearResult = applyCommandToItems(items, { ...command, action: "clear_display" }, payload, iso, activeChannel, state);
      const logResult = applyCommandToItems(items, { ...command, action: "clear_current_service_log" }, payload, iso, activeChannel, state);
      return { ...clearResult, ...logResult, skipOrderAudit: true };
    }
    default:
      throw new Error("Neznámá command action: " + (command.action || "(prázdná)"));
  }
}

function orderMapFromItems(items: Item[]): Map<string, Item> {
  const map = new Map<string, Item>();
  items.forEach((item) => {
    if (canonicalItemType(item.type) !== "order") return;
    const id = String(item.id || "");
    if (id) map.set(id, { ...item });
  });
  return map;
}

function extractOrderTotalPrice(item: Item, data: Record<string, unknown>): string {
  const candidates = [data.total_price, data.totalPrice, data.price_total, data.priceTotal, data.price, data.cena, data.total];
  for (const value of candidates) {
    if (value == null || value === "") continue;
    return String(value);
  }
  const text = [item.subtitle, item.body].filter(Boolean).join("\n");
  const matches = Array.from(String(text).matchAll(/(\d+(?:[.,]\d+)?)\s*kč/gi));
  if (!matches.length) return "";
  const sum = matches.reduce((total, match) => total + Number(String(match[1]).replace(",", ".")), 0);
  return Number.isFinite(sum) ? String(sum) : "";
}

function extractOrderCustomerOrTable(item: Item, data: Record<string, unknown>): string {
  const explicit =
    data.table ||
    data.table_name ||
    data.tableName ||
    data.customer ||
    data.customer_name ||
    data.customerName ||
    data.person ||
    data.name ||
    data.customer_or_table ||
    data.customerOrTable;
  return String(explicit || stripOrderReceiptSubtitlePrefix(item.subtitle) || "");
}

function deriveOrderAuditMutation(
  beforeItems: Item[],
  afterItems: Item[],
  meta: { action: string; source: string; occurredAt: string; commandId?: string },
) {
  const before = orderMapFromItems(beforeItems);
  const after = orderMapFromItems(afterItems);
  const events: EventRecord[] = [];
  const archiveUpdates: { item: Item; eventType: string; source: string; occurredAt: string }[] = [];
  const action = String(meta.action || "unknown");
  const source = String(meta.source || "system");
  const occurredAt = String(meta.occurredAt || nowIso());
  const skipRemoval =
    action === "clear_display" || action === "clear_channel" || action === "clear_display_and_current_service_log";
  const ids = new Set([...before.keys(), ...after.keys()]);
  ids.forEach((orderId) => {
    const beforeItem = before.get(orderId) || null;
    const afterItem = after.get(orderId) || null;
    const pushEvent = (item: Item, type: string, itemName = "", extra: Record<string, unknown> = {}) => {
      const data = parseDataObject(item.data_json);
      events.push({
        event_id: "evt-" + crypto.randomUUID(),
        service_id: String(data.service_id || pragueServiceId(new Date(item.created_at || occurredAt))),
        order_id: String(item.id || ""),
        order_number: extractOrderNumber(item),
        event_type: type,
        source,
        occurred_at: occurredAt,
        item_name: itemName,
        details_json: safeJsonStringify({ action, command_id: meta.commandId || "", ...extra }),
        before_json: beforeItem ? safeJsonStringify(beforeItem) : "",
        after_json: afterItem ? safeJsonStringify(afterItem) : "",
      });
    };
    if (!beforeItem && afterItem) {
      pushEvent(afterItem, "created");
      archiveUpdates.push({ item: afterItem, eventType: "created", source, occurredAt });
      return;
    }
    if (beforeItem && !afterItem) {
      if (skipRemoval) return;
      pushEvent(beforeItem, "removed_from_display");
      archiveUpdates.push({ item: beforeItem, eventType: "removed_from_display", source, occurredAt });
      return;
    }
    if (!beforeItem || !afterItem) return;
    const beforeStatus = getMainOrderStatus(beforeItem.status);
    const afterStatus = getMainOrderStatus(afterItem.status);
    if (beforeStatus !== afterStatus) {
      let eventType = "status_changed";
      if (afterStatus === "completed") eventType = "completed";
      else if (afterStatus === "cancelled") eventType = "cancelled";
      else if (afterStatus === "waiting") eventType = "reopened";
      pushEvent(afterItem, eventType, "", { from: beforeStatus, to: afterStatus });
      archiveUpdates.push({ item: afterItem, eventType, source, occurredAt });
    }
    const beforeServed = getServedOrderItems(parseDataObject(beforeItem.data_json));
    const afterServed = getServedOrderItems(parseDataObject(afterItem.data_json));
    const beforeKeys = new Set(beforeServed.map(normalizeOrderItemStateKey));
    const afterKeys = new Set(afterServed.map(normalizeOrderItemStateKey));
    afterServed.forEach((value) => {
      const key = normalizeOrderItemStateKey(value);
      if (!beforeKeys.has(key)) pushEvent(afterItem, "item_served", value);
    });
    beforeServed.forEach((value) => {
      const key = normalizeOrderItemStateKey(value);
      if (!afterKeys.has(key)) pushEvent(afterItem, "item_reopened", value);
    });
  });
  return { events, archiveUpdates };
}

function applyArchiveUpdates(state: DisplayState, updates: { item: Item; eventType: string; source: string; occurredAt: string }[]) {
  updates.forEach((update) => {
    const item = normalizeItemRecord(update.item);
    const data = parseDataObject(item.data_json);
    const status = getMainOrderStatus(item.status);
    const at = update.occurredAt;
    const existing = state.archive.find((record) => String(record.order_id) === String(item.id)) || ({} as ArchiveRecord);
    const receivedAt = String(existing.received_at || data.received_at || item.created_at || at);
    const record: ArchiveRecord = {
      ...existing,
      order_id: String(item.id || existing.order_id || ""),
      service_id: String(existing.service_id || data.service_id || pragueServiceId(new Date(receivedAt))),
      order_number: extractOrderNumber(item),
      title: item.title,
      subtitle: item.subtitle,
      body: item.body,
      status,
      received_at: receivedAt,
      updated_at: at,
      total_price: extractOrderTotalPrice(item, data),
      customer_or_table: extractOrderCustomerOrTable(item, data),
      served_items_json: safeJsonStringify(getServedOrderItems(data)),
      pending_items_json: safeJsonStringify(getPendingOrderItems(item, data)),
      item_json: safeJsonStringify(item),
      last_source: update.source,
    };
    if (update.eventType === "completed") {
      if (!record.first_completed_at) record.first_completed_at = at;
      record.last_completed_at = at;
    }
    if (update.eventType === "cancelled") record.cancelled_at = at;
    if (update.eventType === "removed_from_display") record.hidden_from_display_at = at;
    const idx = state.archive.findIndex((row) => String(row.order_id) === record.order_id);
    if (idx >= 0) state.archive[idx] = record;
    else state.archive.push(record);
  });
}

function visibleItems(state: DisplayState, activeChannel: string): Item[] {
  return state.items
    .filter((item) => {
      if (!item.id) return false;
      if (item.channel && item.channel !== activeChannel) return false;
      if (item.expires_at) {
        const expiry = new Date(item.expires_at);
        if (!Number.isNaN(expiry.getTime()) && expiry.getTime() < Date.now()) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const sortA = Number(a.sort) || 0;
      const sortB = Number(b.sort) || 0;
      if (sortA !== sortB) return sortA - sortB;
      return (Number(b.priority) || 0) - (Number(a.priority) || 0);
    });
}

function parsePayload(value: unknown): Record<string, unknown> {
  if (value == null || value === "") return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("payload musí být JSON objekt.");
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error("Neplatný payload: " + (error instanceof Error ? error.message : String(error)));
  }
}

export class DisplayEngine {
  state: DisplayState;
  dirty = false;

  constructor(state?: DisplayState) {
    this.state = state ? clone(state) : emptyState();
  }

  private mark() {
    this.dirty = true;
  }

  private buildPayload(commandReport: { processed: number; errors: unknown[]; busy: boolean }) {
    const activeChannel = String(this.state.settings.active_channel || "main");
    return {
      settings: this.state.settings || {},
      activeChannel,
      items: visibleItems(this.state, activeChannel),
      commandReport,
      syncState: {
        manualRevision: Number(this.state.manualRevision || 0),
        lastManualEventAt: String(this.state.lastManualEventAt || ""),
        currentServiceId: pragueServiceId(),
      },
      serverTime: nowIso(),
    };
  }

  processPendingCommands() {
    const activeChannel = String(this.state.settings.active_channel || "main");
    const pending = this.state.commands.filter((command) => isPendingCommandStatus(command.status));
    if (!pending.length) return { processed: 0, errors: [] as unknown[], busy: false };
    const iso = nowIso();
    const errors: { commandId: string; action: string; error: string }[] = [];
    let processedCount = 0;
    const knownFinished = new Set(
      this.state.commands.filter((c) => c.command_id && !isPendingCommandStatus(c.status)).map((c) => c.command_id),
    );
    let barrierIndex = -1;
    this.state.commands.forEach((command, index) => {
      const action = canonicalCommandAction(command.action);
      if (isPendingCommandStatus(command.status) && (action === "clear_display" || action === "clear_display_and_current_service_log")) {
        barrierIndex = index;
      }
    });
    const idsSeen = new Set<string>();
    const auditMutations: ReturnType<typeof deriveOrderAuditMutation>[] = [];
    this.state.commands.forEach((command, commandIndex) => {
      if (!isPendingCommandStatus(command.status)) return;
      if (barrierIndex >= 0 && commandIndex < barrierIndex) {
        command.status = "superseded";
        command.processed_at = iso;
        command.result = { reason: "Přeskočeno kvůli novějšímu vyčištění displeje." };
        this.mark();
        return;
      }
      if (!command.command_id) {
        command.status = "error";
        command.error = "Chybí command_id.";
        command.processed_at = iso;
        errors.push({ commandId: "", action: command.action, error: command.error });
        this.mark();
        return;
      }
      if (knownFinished.has(command.command_id) || idsSeen.has(command.command_id)) {
        command.status = "duplicate";
        command.processed_at = iso;
        command.result = { reason: "Stejné command_id už bylo zpracováno." };
        this.mark();
        return;
      }
      idsSeen.add(command.command_id);
      try {
        const payload = command.payload || {};
        const canonical = canonicalCommandAction(command.action);
        if (isOrderLogClearAction(canonical) && auditMutations.length) {
          auditMutations.splice(0, auditMutations.length).forEach((mutation) => {
            applyArchiveUpdates(this.state, mutation.archiveUpdates);
            this.state.events.push(...mutation.events);
          });
        }
        const beforeItems = clone(this.state.items);
        const result = applyCommandToItems(
          this.state.items,
          { action: command.action, target: command.target, commandId: command.command_id },
          payload,
          iso,
          activeChannel,
          this.state,
        );
        processedCount += 1;
        if (!result.skipOrderAudit) {
          const mutation = deriveOrderAuditMutation(beforeItems, this.state.items, {
            action: canonical,
            source: String((payload.source as string) || "grok"),
            occurredAt: iso,
            commandId: command.command_id,
          });
          if (mutation.events.length || mutation.archiveUpdates.length) auditMutations.push(mutation);
        }
        command.status = "processed";
        command.processed_at = iso;
        command.result = result;
        this.mark();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        command.status = "error";
        command.error = message.slice(0, 1000);
        command.processed_at = iso;
        errors.push({ commandId: command.command_id, action: command.action, error: command.error });
        this.mark();
      }
    });
    auditMutations.forEach((mutation) => {
      applyArchiveUpdates(this.state, mutation.archiveUpdates);
      this.state.events.push(...mutation.events);
    });
    if (this.state.commands.length > 400) this.state.commands = this.state.commands.slice(-300);
    if (this.state.events.length > 4000) this.state.events = this.state.events.slice(-3000);
    return { processed: processedCount, errors, busy: false };
  }

  getDisplayData() {
    const commandReport = this.processPendingCommands();
    return this.buildPayload(commandReport);
  }

  enqueueCommand(input: CommandInput) {
    const iso = nowIso();
    const payload = parsePayload(input.payload ?? (input.item ? { item: input.item } : input.items ? { items: input.items } : input));
    if (input.item && !payload.item) payload.item = input.item;
    const command: CommandRecord = {
      command_id: String(input.command_id || "cmd-" + crypto.randomUUID()),
      action: String(input.action || payload.action || "upsert_item"),
      target: input.target ?? payload.target ?? "",
      payload,
      created_at: iso,
      status: "pending",
      processed_at: "",
      error: "",
      result: {},
    };
    this.state.commands.push(command);
    this.mark();
    const report = this.processPendingCommands();
    return { command, report, data: this.buildPayload(report) };
  }

  performDisplayAction(input: Record<string, unknown>) {
    const commandReport = this.processPendingCommands();
    const itemId = String(input.item_id || input.itemId || "").trim();
    const index = this.state.items.findIndex((item) => String(item.id || "") === itemId);
    if (index < 0) {
      return {
        ok: false,
        conflict: true,
        message: "Karta už na serveru neexistuje.",
        data: this.buildPayload(commandReport),
      };
    }
    const current = this.state.items[index];
    const expectedUpdatedAt = String(input.expected_updated_at || input.expectedUpdatedAt || "");
    const expectedStatus = String(input.expected_status || input.expectedStatus || "").toLowerCase();
    if (
      (expectedUpdatedAt && String(current.updated_at || "") !== expectedUpdatedAt) ||
      (expectedStatus && String(current.status || "").toLowerCase() !== expectedStatus)
    ) {
      return {
        ok: false,
        conflict: true,
        message: "Karta se mezitím změnila. Displej byl znovu synchronizován.",
        data: this.buildPayload(commandReport),
      };
    }
    const iso = nowIso();
    const beforeItems = clone(this.state.items);
    const action = String(input.action || "").trim().toLowerCase();
    let result: CommandResult;
    const extraMutations: ReturnType<typeof deriveOrderAuditMutation>[] = [];
    if (action === "toggle_order_completion") {
      if (canonicalItemType(current.type) !== "order") throw new Error("toggle_order_completion lze použít jen na objednávku.");
      const status = getMainOrderStatus(current.status);
      if (status === "waiting") result = completeOrderAtIndex(this.state.items, index, iso);
      else if (status === "completed") result = reopenOrderAtIndex(this.state.items, index, iso);
      else result = { changed: false, itemId, status };
    } else if (action === "set_order_item_states") {
      result = applyCommandToItems(
        this.state.items,
        { action: "set_order_item_states", target: itemId, commandId: "" },
        { served_items: Array.isArray(input.served_items) ? input.served_items : input.servedItems, complete_when_empty: true },
        iso,
        String(this.state.settings.active_channel || "main"),
        this.state,
      );
    } else if (action === "complete_reminder") {
      if (canonicalItemType(current.type) !== "reminder") throw new Error("complete_reminder lze použít jen na Připomínku.");
      result = completeCardAtIndex(this.state.items, index, iso, false);
    } else if (action === "swipe_item") {
      const type = canonicalItemType(current.type);
      if (type === "order") {
        const status = getMainOrderStatus(current.status);
        if (status === "waiting") {
          const beforeCancel = clone(this.state.items);
          cancelOrderAtIndex(this.state.items, index, iso);
          extraMutations.push(
            deriveOrderAuditMutation(beforeCancel, this.state.items, {
              action: "swipe_cancel_order",
              source: "display",
              occurredAt: iso,
            }),
          );
        }
      }
      const beforeRemove = clone(this.state.items);
      const swipeIndex = this.state.items.findIndex((item) => String(item.id || "") === itemId);
      const removed = swipeIndex >= 0 ? this.state.items.splice(swipeIndex, 1)[0] : current;
      if (type === "order") {
        for (let i = this.state.items.length - 1; i >= 0; i -= 1) {
          if (getParentOrderId(this.state.items[i]) === String(removed.id || "")) this.state.items.splice(i, 1);
        }
        extraMutations.push(
          deriveOrderAuditMutation(beforeRemove, this.state.items, {
            action: "swipe_hide_order",
            source: "display",
            occurredAt: iso,
          }),
        );
      }
      result = {
        changed: true,
        itemId: String(removed.id || ""),
        type,
        operation: type === "order" && getMainOrderStatus(removed.status) === "cancelled" ? "cancelled_and_hidden" : "hidden_from_display",
      };
    } else {
      throw new Error("Neznámá ruční akce displeje: " + action);
    }
    if (result.changed) {
      this.mark();
      const mainMutation =
        action === "swipe_item"
          ? { events: [] as EventRecord[], archiveUpdates: [] as { item: Item; eventType: string; source: string; occurredAt: string }[] }
          : deriveOrderAuditMutation(beforeItems, this.state.items, {
              action,
              source: "display",
              occurredAt: iso,
            });
      extraMutations.concat(mainMutation.events.length || mainMutation.archiveUpdates.length ? [mainMutation] : []).forEach((mutation) => {
        applyArchiveUpdates(this.state, mutation.archiveUpdates);
        this.state.events.push(...mutation.events);
      });
      this.state.manualRevision = Number(this.state.manualRevision || 0) + 1;
      this.state.lastManualEventAt = iso;
    }
    return { ok: true, busy: false, result, data: this.buildPayload(commandReport) };
  }

  getOrderLog(serviceId?: string) {
    const commandReport = this.processPendingCommands();
    const resolved = String(serviceId || pragueServiceId());
    return {
      serviceId: resolved,
      orders: this.state.archive.filter((record) => String(record.service_id || "") === resolved),
      events: this.state.events.filter((record) => String(record.service_id || "") === resolved),
      commandReport,
      serverTime: nowIso(),
    };
  }
}
