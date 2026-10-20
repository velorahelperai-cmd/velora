import { afterEach, beforeEach, expect, it, vi } from "vitest";

type Slot = { value?: unknown; deps?: unknown[]; cleanup?: () => void; replay?: () => void };
const state = vi.hoisted(() => ({
  slots: [] as Slot[],
  cursor: 0,
  effects: [] as Array<() => void>,
  frames: [] as Array<() => void>,
  ioCallback: null as null | ((entries: Array<{ isIntersecting: boolean }>) => void),
  ioDisconnect: vi.fn(),
  visibility: "visible" as DocumentVisibilityState,
  reducedMotion: false,
  play: vi.fn(async () => undefined),
  pause: vi.fn(),
  load: vi.fn(),
  removeAttribute: vi.fn(),
  setAttribute: vi.fn(),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  const slot = () => state.slots[state.cursor++] ?? (state.slots[state.cursor - 1] = {});
  const memo = (fn: () => unknown, deps: unknown[]) => {
    const s = slot();
    if (!s.deps || deps.some((v, i) => !Object.is(v, s.deps![i]))) {
      s.value = fn();
      s.deps = deps;
    }
    return s.value;
  };
  return {
    ...actual,
    useSyncExternalStore(_subscribe: unknown, getSnapshot: () => unknown) { return getSnapshot(); },
    useState(initial: unknown) {
      const s = slot();
      if (!("value" in s)) s.value = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [
        s.value,
        (v: unknown) => {
          s.value = typeof v === "function" ? (v as (p: unknown) => unknown)(s.value) : v;
        },
      ];
    },
    useRef(initial: unknown) {
      const s = slot();
      return s.value ?? (s.value = { current: initial });
    },
    useMemo: memo,
    useCallback: (fn: () => unknown, deps: unknown[]) => memo(() => fn, deps),
    useEffect(fn: () => void | (() => void), deps: unknown[]) {
      const s = slot();
      if (!s.deps || deps.some((v, i) => !Object.is(v, s.deps![i]))) {
        s.replay = () => {
          s.cleanup?.();
          s.cleanup = fn() || undefined;
        };
        state.effects.push(s.replay);
        s.deps = deps;
      }
    },
  };
});

vi.mock("./setup-studio.module.css", () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));

import { SetupStudioNoura } from "./setup-studio-noura";

function flushEffects() {
  state.effects.splice(0).forEach((fn) => fn());
}

function flushFrames() {
  const frames = state.frames.splice(0);
  frames.forEach((fn) => fn());
}

function walk(node: unknown, visit: (el: { type: unknown; props: Record<string, unknown> }) => void) {
  if (!node || typeof node !== "object") return;
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (el.props) visit(el as { type: unknown; props: Record<string, unknown> });
  const kids = el.props?.children;
  if (Array.isArray(kids)) kids.forEach((k) => walk(k, visit));
  else if (kids) walk(kids, visit);
}

function findAll(tree: unknown, type: string) {
  const out: Array<{ type: unknown; props: Record<string, unknown> }> = [];
  walk(tree, (el) => {
    if (el.type === type) out.push(el);
  });
  return out;
}

function bindRef(ref: unknown, value: unknown) {
  if (typeof ref === "function") ref(value);
  else if (ref && typeof ref === "object" && "current" in (ref as object)) {
    (ref as { current: unknown }).current = value;
  }
}

function attachRefs(tree: unknown) {
  walk(tree, (el) => {
    if (el.props["data-setup-noura"] === "true") {
      bindRef(el.props.ref, { nodeType: 1 });
    }
    if (el.type === "video") {
      const fake = {
        muted: false,
        defaultMuted: false,
        pause: state.pause,
        play: state.play,
        load: state.load,
        removeAttribute: state.removeAttribute,
        setAttribute: state.setAttribute,
      };
      bindRef(el.props.ref, fake);
    }
  });
}

function render(props: { ar: boolean; motionEnabled: boolean }) {
  state.cursor = 0;
  function expand(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(expand);
    if (!node || typeof node !== "object") return node;
    const el = node as { type?: unknown; props?: Record<string, unknown> };
    if (typeof el.type === "function") return expand((el.type as (props: Record<string, unknown>) => unknown)(el.props ?? {}));
    return el.props ? { ...el, props: { ...el.props, children: expand(el.props.children) } } : el;
  }
  const tree = expand(SetupStudioNoura(props));
  const used = state.cursor;
  for (const slot of state.slots.slice(used)) slot.cleanup?.();
  state.slots.length = used;
  attachRefs(tree);
  flushEffects();
  return tree;
}

function advanceCritical() {
  flushFrames();
  flushFrames();
}

beforeEach(() => {
  state.slots = [];
  state.effects = [];
  state.frames = [];
  state.ioCallback = null;
  state.ioDisconnect.mockReset();
  state.visibility = "visible";
  state.reducedMotion = false;
  state.play.mockReset().mockResolvedValue(undefined);
  state.pause.mockReset();
  state.load.mockReset();
  state.removeAttribute.mockReset();
  state.setAttribute.mockReset();
  vi.stubGlobal("window", {
    matchMedia: (query: string) => ({
      matches: state.reducedMotion && query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
    requestAnimationFrame: (fn: () => void) => {
      state.frames.push(fn);
      return state.frames.length;
    },
    cancelAnimationFrame: () => {},
  });
  vi.stubGlobal("document", {
    get visibilityState() {
      return state.visibility;
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
        state.ioCallback = cb;
      }
      observe() {
        state.ioCallback?.([{ isIntersecting: true }]);
      }
      disconnect() {
        state.ioDisconnect();
      }
    },
  );
});

afterEach(() => {
  for (const slot of state.slots) slot.cleanup?.();
  vi.unstubAllGlobals();
});

const VIDEO = "/media/setup/character-short-hair-petrol-alpha.webm";
const POSTER = "/media/setup/character-short-hair-petrol-alpha-poster.png";
const source = (tree: unknown) => findAll(tree, "video")[0]?.props.src ?? findAll(tree, "img")[0]?.props.src;

it("defers the alpha video until critical frames and then autoplays muted without controls", () => {
  expect(source(render({ ar: true, motionEnabled: true }))).toBe(POSTER);
  advanceCritical();
  const tree = render({ ar: true, motionEnabled: true });
  expect(source(tree)).toBe(VIDEO);
  const video = findAll(tree, "video")[0]!;
  expect(video.props.controls).toBe(false);expect(video.props.autoPlay).toBe(true);
  expect(video.props.muted).toBe(true);expect(video.props.loop).toBe(true);expect(video.props.playsInline).toBe(true);
  expect(findAll(tree, "img")[0]?.props.height).toBe(1168);
  expect(state.play).toHaveBeenCalled();
});

it("uses only transparent static fallback while reduced-motion is requested", () => {
  state.reducedMotion = true;
  render({ ar: true, motionEnabled: true }); advanceCritical();
  expect(source(render({ ar: true, motionEnabled: true }))).toBe(POSTER);
  expect(state.play).not.toHaveBeenCalled();
  state.reducedMotion = false;
  expect(source(render({ ar: true, motionEnabled: true }))).toBe(VIDEO);
  state.reducedMotion = true;
  expect(source(render({ ar: true, motionEnabled: true }))).toBe(POSTER);
  expect(state.removeAttribute).toHaveBeenCalledWith("src");
});

it("reattaches the source when development Strict Mode replays playback setup", () => {
  render({ ar: true, motionEnabled: true });advanceCritical();render({ ar: true, motionEnabled: true });
  state.setAttribute.mockClear();state.play.mockClear();
  state.slots.at(-1)?.replay?.();
  expect(state.removeAttribute).toHaveBeenCalledWith("src");
  expect(state.setAttribute).toHaveBeenCalledWith("src", VIDEO);
  expect(state.play).toHaveBeenCalledOnce();
});

it("marks actual playback so the alpha video does not reveal a duplicate poster", () => {
  render({ ar: true, motionEnabled: true });advanceCritical();
  let video=findAll(render({ ar: true, motionEnabled: true }), "video")[0]!;
  expect(video.props["data-playing"]).toBe(false);
  (video.props.onPlaying as () => void)();
  video=findAll(render({ ar: true, motionEnabled: true }), "video")[0]!;
  expect(video.props["data-playing"]).toBe(true);
  (video.props.onError as () => void)();
  const tree=render({ ar: true, motionEnabled: true });
  expect(findAll(tree,"video")).toHaveLength(0);
  expect(findAll(tree,"img")[0]?.props["data-character-motion"]).toBe("static");
});

it("pauses and removes the source when hidden, offscreen or disabled", () => {
  render({ ar: true, motionEnabled: true }); advanceCritical();
  expect(source(render({ ar: true, motionEnabled: true }))).toBe(VIDEO);
  state.visibility = "hidden";
  expect(source(render({ ar: true, motionEnabled: true }))).toBe(POSTER);
  expect(state.pause).toHaveBeenCalled();expect(state.removeAttribute).toHaveBeenCalledWith("src");
  state.visibility = "visible";
  state.ioCallback?.([{ isIntersecting: false }]);
  expect(source(render({ ar: true, motionEnabled: true }))).toBe(POSTER);
  state.ioCallback?.([{ isIntersecting: true }]);
  expect(source(render({ ar: true, motionEnabled: true }))).toBe(VIDEO);
  expect(source(render({ ar: true, motionEnabled: false }))).toBe(POSTER);
});

it("falls back after a video error, without an opaque GIF substitute", () => {
  render({ ar: false, motionEnabled: true }); advanceCritical();
  const video = findAll(render({ ar: false, motionEnabled: true }), "video")[0];
  (video?.props.onError as () => void)();
  const tree=render({ ar: false, motionEnabled: true });
  expect(source(tree)).toBe(POSTER);expect(findAll(tree,"video")).toHaveLength(0);
});

it("autoplay rejection keeps the static alpha fallback", async () => {
  state.play.mockRejectedValueOnce(new Error("blocked"));
  render({ ar: true, motionEnabled: true });advanceCritical();render({ ar: true, motionEnabled: true });
  await Promise.resolve();
  expect(source(render({ ar: true, motionEnabled: true }))).toBe(POSTER);
});

it("ignores a late rejected play promise after hidden unload", async () => {
  let reject: (error: Error) => void = () => {};
  state.play.mockReturnValueOnce(new Promise((_, fail) => { reject=fail; }));
  render({ ar: true, motionEnabled: true });advanceCritical();render({ ar: true, motionEnabled: true });
  state.visibility="hidden";render({ ar: true, motionEnabled: true });reject(new Error("late"));await Promise.resolve();
  state.visibility="visible";expect(source(render({ ar: true, motionEnabled: true }))).toBe(VIDEO);
});

it("disconnects the observer on unmount", () => {
  render({ ar: true, motionEnabled: true });
  for (const slot of state.slots) slot.cleanup?.();
  expect(state.ioDisconnect).toHaveBeenCalled();
});
