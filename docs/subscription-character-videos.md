# Subscription character videos — 2026-10-08

User supplied two local 10-second 1280x720 MP4 clips. The teal character clip is assigned to Noor; the lavender clip to Lina. Dana and Velora retain their existing PNG artwork, as no corresponding clips were supplied.

- Original clips copied unchanged to versioned public/assets/subscription paths with poster frames captured from the supplied videos.
- Character cards use real MP4 MIME, portrait cover framing and the existing card design; nonexistent WebM/HEVC sources were removed.
- Muted visible-only looping, pause/play and optional single-character audio. Hidden/offscreen clips pause; reduced motion defaults to a still poster. Existing PNG artwork remains the failure fallback.
- TypeScript and affected-file ESLint passed. Browser check confirmed both original videos decode/play, Dana remains an image, controls work, only one character has audio, and no runtime errors on desktop/mobile.
- No payment/AI calls, database changes or business-data edits were made.
`nPublished: Vercel dpl_BvMzUg487YctN64695rrdtbDWt9M READY, aliased https://www.velorahelper.com. Both MP4 asset URLs returned 200 with video/mp4 content type.

## Integrated transparent characters

Original clips were processed locally with Robust Video Matting ONNX; foreground and alpha retained across all 240 frames per clip at 24fps. No paid provider API was invoked. Reference: https://github.com/PeterL1n/RobustVideoMatting

Versioned H.264 assets carry a synchronized alpha plane; the client composites only the character onto transparent canvas. This standard video path preserves audio and works without loading an inference model in the browser. Original files remain intact. Transparent posters/fallbacks, offscreen pause, reduced-motion behavior and single-voice controls remain.

Removed visible frame/background and keep controls hidden until hover/focus/touch. Desktop/mobile checks confirmed full foreground and transparent corners, no runtime errors. Fixed independent offscreen buffer sizing for StrictMode/effect recreation; hidden decoder uses a 24fps-limited RAF compositor. Local isolated runtime packages/model stay under ignored tmp, not in deployment.
Transparent version published: dpl_Hu5xuSAEXjyG45VToTZKKZpHRTAN READY on www.velorahelper.com. Both packed MP4 assets returned HTTP 200/video-mp4; local desktop/mobile compositor verification showed full character foreground with transparent corners.
