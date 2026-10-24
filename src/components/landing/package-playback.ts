export type PlaybackSnapshot = Readonly<{ current: number; playing: boolean; muted: boolean; paused: boolean; reduced: boolean; error: boolean }>;
const initial: PlaybackSnapshot = { current: 0, playing: false, muted: false, paused: false, reduced: false, error: false };
/** Owns the three package videos; source assignment is deferred until visible. */
export class PackagePlayback {
  private snapshot = initial;
  private listeners = new Set<() => void>();
  private videos: HTMLVideoElement[] = [];
  private sources: string[] = [];
  private visible = new Set<number>();
  private hidden = true;
  private epoch = 0;
  private explicit = false;
  private mutedByUser: boolean | null = null;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  getServerSnapshot = () => initial;
  private update(value: Partial<PlaybackSnapshot>) {
    this.snapshot = { ...this.snapshot, ...value };
    this.listeners.forEach(listener => listener());
  }
  connect(videos: HTMLVideoElement[], sources: string[]) {
    this.disconnect(); this.videos = videos; this.sources = sources; this.explicit = false;
    this.update({ current: 0, playing: false, error: false });
  }
  disconnect() {
    this.stop();
    this.videos.forEach(video => { video.removeAttribute("src"); video.load(); });
    this.videos = []; this.visible.clear(); this.hidden = true;
  }
  private stop() { this.epoch++; this.videos.forEach(video => video.pause()); this.update({ playing: false }); }
  private allowed(index: number) {
    return index === this.snapshot.current && !this.hidden && this.visible.has(index)
      && !this.snapshot.paused && (!this.snapshot.reduced || this.explicit);
  }
  environment(visible: Iterable<number>, hidden: boolean, reduced: boolean) {
    const oldReduced = this.snapshot.reduced;
    this.visible = new Set(visible); this.hidden = hidden;
    if (reduced && !oldReduced) this.explicit = false;
    this.update({ reduced });
    if (!this.visible.has(this.snapshot.current) && this.visible.size) {
      this.stop(); this.update({ current: [...this.visible].sort((a, b) => a - b)[0] });
    }
    if (!this.allowed(this.snapshot.current)) this.stop(); else void this.start();
  }
  select(index: number) {
    if (!this.videos[index]) return;
    this.stop(); this.explicit = true; this.update({ current: index, paused: false, error: false, muted: this.mutedByUser ?? false });
    try { this.videos[index].currentTime = 0; } catch { /* Source may not be loaded yet. */ }
    void this.start();
  }
  mute() {
    const muted = !this.snapshot.muted; this.mutedByUser = muted;
    this.videos.forEach(video => { video.muted = muted; }); this.update({ muted });
  }
  toggle() {
    const paused = this.snapshot.playing;
    this.explicit = !paused; this.update({ paused, error: false, ...(!paused ? { muted: this.mutedByUser ?? false } : {}) });
    if (paused) this.stop(); else void this.start();
  }
  async start() {
    const index = this.snapshot.current, video = this.videos[index];
    if (!video || !this.allowed(index) || (!video.paused && this.snapshot.playing)) return;
    this.stop(); const token = this.epoch;
    if (video.getAttribute("src") !== this.sources[index]) {
      video.src = this.sources[index]; video.preload = "auto"; video.load();
    }
    video.muted = this.snapshot.muted;
    try {
      await video.play();
      if (token === this.epoch && this.videos[index] === video && this.allowed(index)) this.update({ playing: true, error: false });
      else if (this.videos[this.snapshot.current] !== video || !this.allowed(index)) video.pause();
    } catch (error) {
      if (token !== this.epoch || this.videos[index] !== video || !this.allowed(index)) return;
      // Ask the browser for audible playback; policy denial permits a muted fallback only.
      if (!video.muted && typeof error === "object" && error !== null && "name" in error && error.name === "NotAllowedError") {
        video.muted = true; this.update({ muted: true });
        try {
          await video.play();
          if (token === this.epoch && this.videos[index] === video && this.allowed(index)) this.update({ playing: true, error: false });
          else if (this.videos[this.snapshot.current] !== video || !this.allowed(index)) video.pause();
        } catch {
          if (token === this.epoch && this.videos[index] === video && this.allowed(index)) this.update({ error: true, playing: false });
        }
      } else this.update({ error: true, playing: false });
    }
  }
  played(index: number, video: HTMLVideoElement) {
    if (this.videos[index] !== video || !this.allowed(index)) { video.pause(); return; }
    this.update({ playing: true, error: false });
  }
  paused(index: number, video: HTMLVideoElement) {
    if (this.videos[index] === video && index === this.snapshot.current && video.paused) this.update({ playing: false });
  }
  ended(index: number, video: HTMLVideoElement) {
    if (this.videos[index] !== video || index !== this.snapshot.current || !video.ended || !this.allowed(index)) return;
    this.stop();
    if (this.snapshot.reduced) { this.explicit = false; return; }
    for (let step = 1; step <= this.videos.length; step++) {
      const next = (index + step) % this.videos.length;
      if (this.visible.has(next)) {
        this.update({ current: next });
        try { this.videos[next].currentTime = 0; } catch { /* Source may not be loaded yet. */ }
        void this.start(); return;
      }
    }
  }
  failed(index: number, video: HTMLVideoElement) {
    if (this.videos[index] === video && index === this.snapshot.current) { this.stop(); this.update({ error: true }); }
  }
  externalPause() { this.explicit = false; this.update({ paused: true }); this.stop(); }
}
