// @bun
// src/tui.tsx
import { memo as _$memo } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { createElement, insert, setProp } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js";
var LOOP_TOOLS = ["create_loop", "list_loops", "stop_loop", "pause_loop", "resume_loop", "run_loop", "schedule_next_run", "clear_loops"];
var loopCache = new Map;
function element(tag, props, children = []) {
  const node = createElement(tag);
  for (const [key, value] of Object.entries(props))
    if (value !== undefined)
      setProp(node, key, value);
  for (const child of children)
    if (child !== null && child !== undefined && child !== false)
      insert(node, child);
  return node;
}
function text(props, children) {
  return element("text", props, children);
}
function box(props, children = []) {
  return element("box", props, children);
}
function loopSnapshotKey(sessionID) {
  return `loop-mode.snapshot.${sessionID}`;
}
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
function isLoopSnapshot(value) {
  if (!isRecord(value))
    return false;
  if (typeof value.id !== "string")
    return false;
  if (typeof value.sessionID !== "string")
    return false;
  if (typeof value.prompt !== "string")
    return false;
  if (!["interval", "dynamic"].includes(String(value.mode)))
    return false;
  if (value.intervalMs !== null && typeof value.intervalMs !== "number")
    return false;
  if (!["active", "paused", "stopped", "completed"].includes(String(value.status)))
    return false;
  if (typeof value.createdAt !== "number")
    return false;
  if (typeof value.updatedAt !== "number")
    return false;
  if (value.nextRunAt !== null && typeof value.nextRunAt !== "number")
    return false;
  if (typeof value.runCount !== "number")
    return false;
  return true;
}
function isLoopList(value) {
  return Array.isArray(value) && value.every(isLoopSnapshot);
}
function cachedLoops(api, sessionID) {
  const memory = loopCache.get(sessionID);
  if (memory)
    return memory;
  const persisted = api.kv?.get(loopSnapshotKey(sessionID), null);
  return isLoopList(persisted) ? persisted : [];
}
function cacheLoops(api, sessionID, loops) {
  loopCache.set(sessionID, loops);
  api.kv?.set(loopSnapshotKey(sessionID), loops);
}
function parseLoopToolOutput(part) {
  if (part.type !== "tool")
    return;
  if (!LOOP_TOOLS.includes(part.tool ?? ""))
    return;
  if (part.state?.status !== "completed")
    return;
  if (typeof part.state.output !== "string")
    return;
  try {
    const parsed = JSON.parse(part.state.output);
    if (!isRecord(parsed))
      return;
    return isLoopList(parsed.loops) ? parsed.loops : undefined;
  } catch {
    return;
  }
}
function loopsFromSession(api, sessionID) {
  const messages = [...api.state.session.messages(sessionID)];
  for (let messageIndex = messages.length - 1;messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (!message)
      continue;
    const parts = [...api.state.part(message.id)].reverse();
    for (const part of parts) {
      const loops = parseLoopToolOutput(part);
      if (loops !== undefined) {
        cacheLoops(api, sessionID, loops);
        return loops;
      }
    }
  }
  return cachedLoops(api, sessionID);
}
function formatInterval(ms) {
  if (ms == null)
    return "dynamic";
  const units = [[86400000, "d"], [3600000, "h"], [60000, "m"], [1000, "s"]];
  for (const [size, suffix] of units) {
    if (ms >= size && ms % size === 0)
      return `${ms / size}${suffix}`;
  }
  return `${Math.round(ms / 1000)}s`;
}
function formatCountdown(msFromNow) {
  const total = Math.max(0, Math.ceil(msFromNow / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const seconds = total % 60;
  if (hours > 0)
    return `${hours}h${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0)
    return `${minutes}m${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}
function loopLine(loop, nowMs) {
  const cadence = loop.mode === "interval" ? `every ${formatInterval(loop.intervalMs)}` : "dynamic";
  const runs = `runs ${loop.runCount}${loop.maxRuns == null ? "" : `/${loop.maxRuns}`}`;
  let next = "";
  if (loop.status === "active") {
    next = loop.nextRunAt != null ? `, next in ${formatCountdown(loop.nextRunAt - nowMs)}` : ", awaiting schedule";
  }
  return `${loop.id} ${cadence}, ${runs}${next}`;
}
function currentSessionID(api) {
  const route = api.route.current;
  if (route.name !== "session")
    return;
  const sessionID = route.params?.sessionID;
  return typeof sessionID === "string" ? sessionID : undefined;
}
function toast(api, message, variant = "info") {
  api.ui.toast({
    title: "Loop",
    message,
    variant,
    duration: 2500
  });
}
async function sendLoopPrompt(api, sessionID, text) {
  await api.client.session.promptAsync({
    sessionID,
    parts: [{
      type: "text",
      text
    }]
  });
}
function actionOption(api, sessionID, title, value, description, prompt) {
  return {
    title,
    value,
    description,
    onSelect: () => {
      sendLoopPrompt(api, sessionID, prompt).then(() => api.ui.dialog.clear()).catch((error) => toast(api, error instanceof Error ? error.message : String(error), "error"));
    }
  };
}
function showSummary(api, sessionID, loops) {
  const DialogSelect = api.ui.DialogSelect;
  const now = Date.now();
  const open = loops.filter((loop) => loop.status === "active" || loop.status === "paused");
  const options = [actionOption(api, sessionID, "Refresh", "refresh", "Ask the agent to list the current loops", "Call list_loops for this session and report each loop briefly."), ...open.flatMap((loop) => [...loop.status === "active" ? [actionOption(api, sessionID, `Run ${loop.id} now`, `run.${loop.id}`, loopLine(loop, now), `Call run_loop with loop_id "${loop.id}" and report the result briefly.`), actionOption(api, sessionID, `Pause ${loop.id}`, `pause.${loop.id}`, loopLine(loop, now), `Call pause_loop with loop_id "${loop.id}" and report the result briefly.`)] : [actionOption(api, sessionID, `Resume ${loop.id}`, `resume.${loop.id}`, loopLine(loop, now), `Call resume_loop with loop_id "${loop.id}" and report the result briefly.`)], actionOption(api, sessionID, `Stop ${loop.id}`, `stop.${loop.id}`, loopLine(loop, now), `Call stop_loop with loop_id "${loop.id}" and report the result briefly.`)]), ...loops.some((loop) => loop.status === "stopped" || loop.status === "completed") ? [actionOption(api, sessionID, "Clear closed loops", "clear", "Delete stopped and completed loops", "Call clear_loops for this session and report how many loops were removed.")] : []];
  api.ui.dialog.setSize("large");
  api.ui.dialog.replace(() => DialogSelect({
    title: "Loops",
    placeholder: open.length === 0 ? "No open loops in this session." : open.map((loop) => loopLine(loop, now)).join(`
`),
    options,
    onSelect(option) {
      option.onSelect?.();
    }
  }));
}
function LoopSidebar(props) {
  const theme = () => props.api.theme.current;
  const [nowMs, setNowMs] = createSignal(Date.now());
  const timer = setInterval(() => setNowMs(Date.now()), 1000);
  onCleanup(() => clearInterval(timer));
  const loops = createMemo(() => {
    props.api.state.session.messages(props.sessionID);
    return loopsFromSession(props.api, props.sessionID);
  });
  const open = createMemo(() => loops().filter((loop) => loop.status === "active" || loop.status === "paused"));
  return _$createComponent(Show, {
    get when() {
      return open().length > 0;
    },
    get children() {
      var _el$ = _$createElement("box"), _el$2 = _$createElement("text"), _el$3 = _$createElement("b");
      _$insertNode(_el$, _el$2);
      _$insertNode(_el$2, _el$3);
      _$insertNode(_el$3, _$createTextNode(`Loops`));
      _$insert(_el$, _$createComponent(For, {
        get each() {
          return open();
        },
        children: (loop) => (() => {
          var _el$5 = _$createElement("text");
          _$insert(_el$5, () => loop.status === "paused" ? "\u23F8 " : "", null);
          _$insert(_el$5, () => loopLine(loop, nowMs()), null);
          _$effect((_$p) => _$setProp(_el$5, "fg", loop.status === "active" ? theme().textMuted : theme().textMuted, _$p));
          return _el$5;
        })()
      }), null);
      _$effect((_$p) => _$setProp(_el$2, "fg", theme().text, _$p));
      return _el$;
    }
  });
}
function registerLoopCommand(api, command) {
  const modern = api;
  if (modern.keymap?.registerLayer) {
    modern.keymap.registerLayer({
      commands: [{
        namespace: "palette",
        name: command.value,
        title: command.title,
        desc: command.description,
        category: command.category,
        run: command.onSelect
      }],
      bindings: []
    });
    return;
  }
  api.command?.register(() => [command]);
}
var tui = async (api) => {
  api.slots.register({
    order: 126,
    slots: {
      sidebar_content(_ctx, props) {
        return _$createComponent(LoopSidebar, {
          api,
          get sessionID() {
            return props.session_id;
          }
        });
      }
    }
  });
  registerLoopCommand(api, {
    title: "Loops",
    value: "loop.show",
    category: "Loop",
    description: "View, run, pause, resume, or stop the recurring loops in this session",
    onSelect: () => {
      const sessionID = currentSessionID(api);
      if (!sessionID) {
        toast(api, "Open a session before viewing loops.", "warning");
        return;
      }
      showSummary(api, sessionID, loopsFromSession(api, sessionID));
    }
  });
};
function loopsFromV2Messages(messages) {
  for (let messageIndex = messages.length - 1;messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (!message || message.type !== "assistant")
      continue;
    for (let partIndex = message.content.length - 1;partIndex >= 0; partIndex -= 1) {
      const part = message.content[partIndex];
      if (!part || part.type !== "tool" || !LOOP_TOOLS.includes(part.name))
        continue;
      if (part.state.status !== "completed")
        continue;
      for (const content of part.state.content) {
        if (content.type !== "text")
          continue;
        try {
          const parsed = JSON.parse(content.text);
          if (isRecord(parsed) && isLoopList(parsed.loops))
            return parsed.loops;
        } catch {}
      }
    }
  }
  return;
}
function currentSessionIDV2(api) {
  const route = api.ui.router.current();
  return route.type === "session" ? route.sessionID : undefined;
}
function toastV2(api, message, variant = "info") {
  api.ui.toast.show({
    title: "Loop",
    message,
    variant,
    duration: 2500
  });
}
function promptForAction(action, loopID) {
  if (action === "refresh")
    return "Call list_loops for this session and report each loop briefly.";
  if (action === "clear")
    return "Call clear_loops for this session and report how many loops were removed.";
  if (!loopID)
    return;
  if (action === "run")
    return `Call run_loop with loop_id "${loopID}" and report the result briefly.`;
  if (action === "pause")
    return `Call pause_loop with loop_id "${loopID}" and report the result briefly.`;
  if (action === "resume")
    return `Call resume_loop with loop_id "${loopID}" and report the result briefly.`;
  if (action === "stop")
    return `Call stop_loop with loop_id "${loopID}" and report the result briefly.`;
  return;
}
async function showSummaryV2(api, sessionID, loops) {
  const now = Date.now();
  const open = loops.filter((loop) => loop.status === "active" || loop.status === "paused");
  const options = [{
    title: "Refresh",
    value: "refresh",
    description: "Ask the agent to list the current loops"
  }, ...open.flatMap((loop) => [...loop.status === "active" ? [{
    title: `Run ${loop.id} now`,
    value: `run.${loop.id}`,
    description: loopLine(loop, now)
  }, {
    title: `Pause ${loop.id}`,
    value: `pause.${loop.id}`,
    description: loopLine(loop, now)
  }] : [{
    title: `Resume ${loop.id}`,
    value: `resume.${loop.id}`,
    description: loopLine(loop, now)
  }], {
    title: `Stop ${loop.id}`,
    value: `stop.${loop.id}`,
    description: loopLine(loop, now)
  }]), ...loops.some((loop) => loop.status === "stopped" || loop.status === "completed") ? [{
    title: "Clear closed loops",
    value: "clear",
    description: "Delete stopped and completed loops"
  }] : []];
  api.ui.dialog.set({
    size: "large"
  });
  const selected = await api.ui.dialog.select({
    title: "Loops",
    placeholder: open.length === 0 ? "No open loops in this session." : open.map((loop) => loopLine(loop, now)).join(`
`),
    options
  });
  if (!selected)
    return;
  const separator = selected.indexOf(".");
  const action = separator === -1 ? selected : selected.slice(0, separator);
  const loopID = separator === -1 ? undefined : selected.slice(separator + 1);
  const prompt = promptForAction(action, loopID);
  if (!prompt)
    return;
  try {
    await api.client.session.prompt({
      sessionID,
      text: prompt
    });
  } catch (error) {
    toastV2(api, error instanceof Error ? error.message : String(error), "error");
  }
}
function LoopSidebarV2(api, sessionID) {
  const [cache, setCache] = api.storage.memory(`loop-mode.v2.${sessionID}`, {
    initial: {
      loops: []
    }
  });
  const loops = createMemo(() => {
    const found = loopsFromV2Messages(api.data.session.message.list(sessionID));
    return found ?? cache.loops;
  });
  createEffect(() => {
    const found = loopsFromV2Messages(api.data.session.message.list(sessionID));
    if (!found)
      return;
    untrack(() => setCache((draft) => {
      draft.loops = found;
    }));
  });
  const open = createMemo(() => loops().filter((loop) => loop.status === "active" || loop.status === "paused"));
  const [nowMs, setNowMs] = createSignal(Date.now());
  createEffect(() => {
    if (!open().some((loop) => loop.status === "active"))
      return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    onCleanup(() => clearInterval(timer));
  });
  return box({}, [() => {
    const loops = open();
    if (loops.length === 0)
      return null;
    return box({}, [text({
      fg: api.theme.text.base
    }, ["Loops"]), ...loops.map((loop) => text({
      fg: api.theme.text.muted
    }, [`${loop.status === "paused" ? "paused " : ""}${loopLine(loop, nowMs())}`]))]);
  }]);
}
function LoopKeymapLayerV2(api) {
  api.keymap.layer(() => ({
    commands: [{
      id: "loop.show",
      title: "Loops",
      description: "View, run, pause, resume, or stop the recurring loops in this session",
      group: "Loop",
      palette: true,
      run: () => {
        const sessionID = currentSessionIDV2(api);
        if (!sessionID) {
          toastV2(api, "Open a session before viewing loops.", "warning");
          return;
        }
        const loops = loopsFromV2Messages(api.data.session.message.list(sessionID)) ?? [];
        showSummaryV2(api, sessionID, loops);
      }
    }]
  }));
  return null;
}
function setupTuiV2(context) {
  const offSidebar = context.ui.slot({
    append: "sidebar.content",
    render: (props) => LoopSidebarV2(context, props.sessionID)
  });
  const offApp = context.ui.slot({
    append: "app",
    render: () => LoopKeymapLayerV2(context)
  });
  return () => {
    offSidebar();
    offApp();
  };
}
var plugin = {
  id: "local.loop-mode.tui",
  tui,
  setup: setupTuiV2
};
var tui_default = plugin;
export {
  tui_default as default,
  formatCountdown,
  formatInterval,
  loopLine,
  loopsFromSession,
  loopsFromV2Messages,
  setupTuiV2
};
