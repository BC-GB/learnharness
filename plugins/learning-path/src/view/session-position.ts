import type { PluginFrontendContext } from "../../.sdk/index.d.ts";
import type { SessionParentResult } from "../session-types.ts";
import { EVENT_PATHS_CHANGED, EVENT_SESSION_POSITION_CHANGED } from "../topics.ts";

export function mountSessionPosition(
  ctx: PluginFrontendContext,
  container: HTMLElement,
  signal: AbortSignal,
  chatId: string,
): () => void {
  const document = container.ownerDocument;
  const win = document.defaultView!;
  const courseId = ctx.app.course?.().id;
  const card = document.createElement("aside");
  card.className = "lp-session-position";
  card.setAttribute("aria-label", "Learning Path position");
  const header = document.createElement("div");
  header.className = "lp-session-position-header";
  const grip = document.createElement("button");
  grip.type = "button";
  grip.textContent = "⠿";
  grip.setAttribute("aria-label", "Move Now panel");
  grip.title = "Drag or use arrow keys to move";
  const title = document.createElement("h2");
  title.textContent = "Now";
  const toggle = document.createElement("button");
  toggle.type = "button";
  const fields = document.createElement("dl");
  const moduleLabel = document.createElement("dt");
  moduleLabel.textContent = "Module";
  const moduleTitle = document.createElement("dd");
  const nodeLabel = document.createElement("dt");
  nodeLabel.textContent = "Node";
  const nodeTitle = document.createElement("dd");
  nodeTitle.setAttribute("aria-live", "polite");
  fields.append(moduleLabel, moduleTitle, nodeLabel, nodeTitle);
  header.append(grip, title, toggle);
  card.append(header, fields);

  function updateToggle(): void {
    toggle.textContent = fields.hidden ? "▾" : "▴";
    toggle.setAttribute("aria-expanded", String(!fields.hidden));
    toggle.setAttribute("aria-label", fields.hidden ? "Expand Now panel" : "Minimize Now panel");
  }
  toggle.addEventListener("click", () => {
    fields.hidden = !fields.hidden;
    updateToggle();
  });
  updateToggle();

  const positionAt = (left: number, top: number) => {
    card.style.left = `${Math.max(16, Math.min(left, win.innerWidth - card.offsetWidth - 16))}px`;
    card.style.top = `${Math.max(64, Math.min(top, win.innerHeight - card.offsetHeight - 96))}px`;
    card.style.right = "auto";
  };
  let drag: { pointer: number; xOffset: number; yOffset: number } | undefined;
  grip.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const box = card.getBoundingClientRect();
    drag = { pointer: event.pointerId, xOffset: event.clientX - box.left, yOffset: event.clientY - box.top };
    grip.setPointerCapture(event.pointerId);
  });
  grip.addEventListener("pointermove", (event) => {
    if (drag?.pointer === event.pointerId) positionAt(event.clientX - drag.xOffset, event.clientY - drag.yOffset);
  });
  grip.addEventListener("lostpointercapture", () => { drag = undefined; });
  const moveKeys = new Map([
    ["ArrowLeft", [-20, 0]], ["ArrowRight", [20, 0]],
    ["ArrowUp", [0, -20]], ["ArrowDown", [0, 20]],
  ]);
  grip.addEventListener("keydown", (event) => {
    const delta = moveKeys.get(event.key);
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    const box = card.getBoundingClientRect();
    positionAt(box.left + delta[0]!, box.top + delta[1]!);
  });
  const clamp = () => {
    if (!card.style.left || !card.isConnected) return;
    const box = card.getBoundingClientRect();
    positionAt(box.left, box.top);
  };
  const observer = typeof win.ResizeObserver === "function" ? new win.ResizeObserver(clamp) : undefined;
  observer?.observe(card);
  win.addEventListener("resize", clamp);

  let generation = 0;
  let disposed = false;
  async function refresh(): Promise<void> {
    const ticket = ++generation;
    try {
      const view = await ctx.call<SessionParentResult>("sessions.forChat", { chatId });
      if (signal.aborted || disposed || ticket !== generation || ctx.app.course?.().id !== courseId) return;
      const scope = view.moduleLink;
      if (!view.exists || scope?.kind !== "teaching") {
        card.remove();
        return;
      }
      moduleTitle.textContent = scope.moduleTitle;
      const node = scope.currentNodeTitle ?? "Waiting for the tutor to start a node";
      if (nodeTitle.textContent !== node) nodeTitle.textContent = node;
      if (card.parentNode !== container) container.append(card);
    } catch { /* A missing path read must not interfere with the lesson. */ }
  }

  const unsubscribe = ctx.onNotification((event) => {
    const data = event.data;
    if (event.topic === EVENT_PATHS_CHANGED || (event.topic === EVENT_SESSION_POSITION_CHANGED &&
        data && typeof data === "object" && "chatId" in data && data.chatId === chatId)) void refresh();
  });
  const resync = ctx.onResync(() => { void refresh(); });
  function cleanup(): void {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    resync();
    observer?.disconnect();
    win.removeEventListener("resize", clamp);
    signal.removeEventListener("abort", cleanup);
    card.remove();
  }
  if (signal.aborted) cleanup();
  else {
    signal.addEventListener("abort", cleanup, { once: true });
    void refresh();
  }
  return cleanup;
}
