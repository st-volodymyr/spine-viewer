# Spine Viewer

A browser-based viewer and reviewer for [Spine](https://esotericsoftware.com/) skeletal animations, built with PixiJS 7 and `@electricelephants/pixi-ext`. Drop in a skeleton + atlas (or a `.spine` archive) and inspect animations, skins, slots, the atlas, and per-animation performance — no Spine editor required.

Supports **Spine 4.1 and 4.2** (both JSON and binary `.skel`).

## Features

- **Load** `.json` / `.skel` + `.atlas` + textures (`.png/.jpg/.avif`), or a single `.spine` archive. Drag-and-drop or file/folder picker.
- **Playback** on up to 12 tracks: per-track animation select, loop toggle, speed, queue, and an event-trigger system (play an animation when a Spine event fires).
- **No auto-play** — a freshly loaded skeleton sits in its setup pose until you pick an animation. Loop is **off by default** (one-shot).
- **Scrubbing & frame-step** — drag any track's progress groove to scrub; ◀ ▶ buttons or `←`/`→` step one frame. Time is shown in milliseconds.
- **Skins** — single-select by default; toggle **Combine skins** to layer several into one.
- **Mix / crossfade** — set a default mix duration so switching animations crossfades.
- **Onion skinning (ghosting)** — translucent ghost poses before/after the current frame to judge timing, spacing and motion arcs.
- **Reference image** — load a mockup behind the skeleton (world space, with opacity) to match poses/proportions.
- **Debug draw** — overlay bones, meshes, bounding boxes, regions, clipping and paths via a custom duck-typed renderer (works on 4.1 and 4.2).
- **Performance for animators:**
  - **Profiler tab** — static, machine-independent cost analysis. Each animation gets an `OK / Watch / Heavy` severity (also an inline dot in the left list) with a breakdown of its drivers: clipping, mesh deforms, blend modes, draw-order changes, attachment swaps, constraints. The summary mirrors Spine's Metrics view (bones, timelines, vertex transforms, constraints) and includes a **per-mask clipping breakdown** (vertex count, convexity, clipped slot/triangle counts).
  - **Timeline heatmap** — while an animation plays, the scrubber groove colors green→red by measured render cost (draw calls / frame time) per timeline position, so you can see *where* in the animation the engine works hardest.
  - **Stress test** — clone the skeleton N times and watch the FPS ceiling.
  - **Perf HUD** (`Perf` button) — live FPS, frame time, draw calls, bone/slot counts, JS heap, VRAM estimate, and warnings.
- **Inspectors** — skeleton tree (bones/slots/skins/events/animations/constraints), atlas inspector, and a **Slots/Placeholders** panel with accessibility badges, copy-name buttons, and the ability to overlay custom text/images at a slot.
- **PNG export** — export the current frame with a transparent background.
- **A/B comparison mode** — load multiple projects and compare animations/skins/slots side by side, plus a **Reskin Overview** that audits attachments at the region level (missing or remapped attachments between projects, with severity).
- **Light/dark theme**, pan/zoom canvas with grid, and a configurable background color.

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Space` | Pause / resume |
| `R` | Reset to setup pose (clears active tracks) |
| `←` / `→` | Step one frame back / forward |
| `L` / `Shift+L` | Toggle loop on the current track / all tracks |
| `+` / `-` | Zoom in / out |
| `0` | Reset view (re-center, zoom 1×) |

## Commands

```bash
npm install
npm run dev      # start the Vite dev server
npm run build    # tsc + vite build → docs/
npm run preview  # serve the production build locally
```

There is no test runner or linter configured; `tsc` (run as part of `npm run build`) is the correctness gate.

## Deployment

The production build outputs to `docs/` with a base path of `/spine-viewer/`, ready to serve from GitHub Pages.

## Tech stack

- **Vite + TypeScript** (strict, ES2020, path alias `@/* → src/*`)
- **PixiJS 7.4.x** via `@electricelephants/pixi-ext` — `SpineElement`, spine type exports, atlas/skeleton loaders
- **`@esotericsoftware/spine-pixi-v7`** (4.2 runtime) and **`@pixi-spine/all-4.1`** (4.1 fallback)
- **JSZip** for `.spine` archive extraction

## Architecture

See [`CLAUDE.md`](./CLAUDE.md) for a detailed map of the initialization order, the `EventBus`/`StateManager` flow, the file-loading pipeline, and panel conventions. In short:

- `StateManager` holds canonical app state and emits events through a small `EventBus`.
- `Viewport` owns the PixiJS `Application` (pan/zoom/grid); `SpineManager` wraps the active `SpineElement` and exposes the animation/skin/profiling API.
- UI panels (`src/ui/panels/`) subscribe to events and refresh independently.
- Performance tooling lives in `src/services/AnimationProfiler.ts` (static cost) and `src/services/PerfSampler.ts` (runtime heatmap); the tracks bar is a shared `TrackBar` component driven by a `TrackController` per mode.
