import { describe, expect, it } from "vitest";
import { PackagePlayback } from "./package-playback";

function deferred() { let resolve!: () => void; let reject!: (reason?: unknown) => void; const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function video() {
  const pending: ReturnType<typeof deferred>[] = [];
  return {
    src: "", preload: "none", muted: true, paused: true, ended: false, currentTime: 0,
    play() { this.paused = false; const task = deferred(); pending.push(task); return task.promise; },
    pause() { this.paused = true; },
    load() {},
    getAttribute(name: string) { return name === "src" ? this.src || null : null; },
    removeAttribute(name: string) { if (name === "src") this.src = ""; },
    pending,
  };
}
function setup() {
  const model = new PackagePlayback(), videos = [video(), video(), video()];
  model.connect(videos as unknown as HTMLVideoElement[], ["noura-ar.webm", "lina-ar.webm", "dana-ar.webm"]);
  return { model, videos };
}
describe("exclusive original package playback", () => {
  it("loads only the current visible source and attempts sound where permitted", () => {
    const { model, videos } = setup();
    expect(videos.every(item => item.src === "")).toBe(true);
    model.environment([0, 1, 2], false, false);
    expect(videos.map(item => item.src)).toEqual(["noura-ar.webm", "", ""]);
    expect(videos[0].muted).toBe(false);
  });
  it("guards rapid selections and stale play rejections without changing the sound preference", async () => {
    const { model, videos } = setup(); model.environment([0, 1, 2], false, false);
    const stale = videos[0].pending[0]; model.mute(); model.select(1); model.select(2);
    stale.reject(); videos[1].pending[0].resolve(); videos[2].pending[0].resolve(); await Promise.resolve();
    expect(model.getSnapshot()).toMatchObject({ current: 2, playing: true, muted: true, error: false });
    expect(videos.map(item => item.paused)).toEqual([true, true, false]);
    expect(videos[2].muted).toBe(true);
  });
  it("does not pause a newer request for the same video when an older promise resolves", async () => {
    const { model, videos } = setup(); model.environment([0, 1, 2], false, false);
    const stale = videos[0].pending[0]; model.select(1); model.select(0);
    const latest = videos[0].pending.at(-1)!; latest.resolve(); await Promise.resolve(); stale.resolve(); await Promise.resolve();
    expect(videos[0].paused).toBe(false); expect(model.getSnapshot().playing).toBe(true);
  });
  it("pauses hidden and offscreen media and resumes only a visible card", async () => {
    const { model, videos } = setup(); model.environment([0], false, false);
    model.environment([], false, false); videos[0].pending[0].resolve(); await Promise.resolve();
    expect(videos.every(item => item.paused)).toBe(true);
    model.environment([1], true, false); expect(videos[1].src).toBe("");
    model.environment([1], false, false); expect(videos[1].src).toBe("lina-ar.webm");
  });
  it("keeps reduced motion static until explicitly selected and does not auto-advance", async () => {
    const { model, videos } = setup(); model.environment([0, 1, 2], false, true);
    expect(videos.every(item => item.pending.length === 0)).toBe(true);
    model.select(1); videos[1].pending[0].resolve(); await Promise.resolve();
    videos[1].ended = true; model.ended(1, videos[1] as unknown as HTMLVideoElement);
    expect(model.getSnapshot().current).toBe(1); expect(videos.every(item => item.paused)).toBe(true);
    expect(videos[2].src).toBe("");
  });
  it("continues the real sequence and ignores ended events from an old selection", async () => {
    const { model, videos } = setup(); model.environment([0, 1, 2], false, false);
    model.select(1); videos[0].ended = true; model.ended(0, videos[0] as unknown as HTMLVideoElement);
    expect(model.getSnapshot().current).toBe(1);
    videos[1].ended = true; model.ended(1, videos[1] as unknown as HTMLVideoElement);
    expect(model.getSnapshot().current).toBe(2); expect(videos[2].src).toBe("dana-ar.webm");
  });
  it("fences old locale promises and retains mute preference across reconnection", async () => {
    const { model, videos } = setup(); model.environment([0, 1, 2], false, false); model.mute();
    const next = [video(), video(), video()];
    model.connect(next as unknown as HTMLVideoElement[], ["noura-en.webm", "lina-en.webm", "dana-en.webm"]);
    model.environment([0, 1, 2], false, false); videos[0].pending[0].resolve(); await Promise.resolve();
    expect(videos.every(item => item.paused && !item.src)).toBe(true);
    expect(next[0].src).toBe("noura-en.webm"); expect(next[0].muted).toBe(true);
    expect(next[1].src).toBe(""); expect(next[2].src).toBe("");
  });
});

describe("browser-policy audio recovery", () => {
  it("falls back to muted autoplay only on a current policy rejection, then lets a character gesture enable sound", async () => {
    const { model, videos } = setup(); model.environment([0, 1, 2], false, false);
    videos[0].pending[0].reject(new DOMException("gesture required", "NotAllowedError")); await Promise.resolve();
    expect(videos[0].muted).toBe(true); expect(videos[0].pending).toHaveLength(2);
    videos[0].pending[1].resolve(); await Promise.resolve();
    expect(model.getSnapshot()).toMatchObject({ playing: true, muted: true, error: false });
    model.select(1); expect(videos[1].muted).toBe(false); expect(videos[0].paused).toBe(true);
  });
  it("retains an explicit mute when selecting another character after policy fallback", async () => {
    const { model, videos } = setup(); model.environment([0, 1, 2], false, false);
    videos[0].pending[0].reject(new DOMException("gesture required", "NotAllowedError")); await Promise.resolve();
    videos[0].pending[1].resolve(); await Promise.resolve(); model.mute(); model.mute(); model.select(1);
    expect(videos[1].muted).toBe(true);
  });
  it("does not retry a stale audible rejection on the old character", async () => {
    const { model, videos } = setup(); model.environment([0, 1, 2], false, false);
    const stale = videos[0].pending[0]; model.select(2); stale.reject(new DOMException("blocked", "NotAllowedError")); await Promise.resolve();
    expect(videos[0].pending).toHaveLength(1); expect(model.getSnapshot().current).toBe(2);
  });
  it("keeps decode failures visible instead of treating them as autoplay policy", async () => {
    const { model, videos } = setup(); model.environment([0], false, false);
    videos[0].pending[0].reject(new DOMException("unsupported", "NotSupportedError")); await Promise.resolve();
    expect(videos[0].pending).toHaveLength(1); expect(model.getSnapshot().error).toBe(true);
  });
});
