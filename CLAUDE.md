# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview
A web-based Spine animation viewer/reviewer built with PixiJS 7 and `@electricelephants/pixi-ext`. Supports Spine 4.1/4.2 (JSON + binary), skeleton/atlas inspection, animation sequencing, placeholders, per-animation performance profiling, and multi-project A/B comparison.

## Commands
```bash
npm run dev          # Start dev server
npm run build        # tsc + vite build → docs/
npm run preview      # Serve production build locally
```
No test runner or linter is configured; `tsc` (run by `npm run build`) is the correctness gate.

## Tech Stack
- **Vite + TypeScript** (strict, ES2020, path alias `@/*` → `src/*`)
- **PixiJS 7.4.x** via `@electricelephants/pixi-ext@1.1.17` — provides `SpineElement`, spine type exports (incl. `Skin`), and auto-registered atlas/skeleton loaders
- **`@esotericsoftware/spine-pixi-v7`** (4.2 runtime) — explicit dependency for the spine-core timeline/attachment classes used by the profiler
- **`@pixi-spine/all-4.1`** — fallback runtime for Spine 4.1 skeletons (`SpineManager.createSpine41`)
- **JSZip** for `.spine` archive extraction
- **`@types/node`** dev dependency — required for `path` and `__dirname` in `vite.config.ts`
- **Deployment**: GitHub Pages (`base: '/spine-viewer/'` in vite.config)
- **tsconfig.json** `include` covers `src/**/*.ts` + `vite.config.ts` (so the IDE TS server types the config file correctly)
- **`vite.config.ts` `resolve.dedupe` + `optimizeDeps.include`** force a SINGLE copy of `@esotericsoftware/spine-core`/`spine-pixi-v7`/`pixi.js`. Without this, the bundler can create two spine-core copies (one via pixi-ext, one via our direct imports), breaking cross-copy `instanceof` checks. We avoid `instanceof` in our own code (see `SkeletonDebug`), but dedupe keeps the runtime's internal checks sound.

## Architecture

### Initialization order (App.ts)
1. `StateManager` — holds all app state (`projectA`, `projectB`, `viewport`, `mode`)
2. `Viewport` — creates PixiJS `Application`, manages canvas pan/zoom, grid
3. `SpineManager` — wraps a single `SpineElement`, exposes animation/skin API
4. `Layout` — builds DOM (toolbar, left panel, right tabs, status bar)
5. Panels — each receives `StateManager`/`SpineManager` refs; subscribe to `EventBus`
6. Keyboard shortcuts and drop zone wired last

### Event-driven communication
- **`EventBus`** (`src/core/EventBus.ts`) — custom pub/sub (`on`, `off`, `emit`). Key events:
  - `project:change` — new spine loaded; all panels call `refresh()`
  - `project:update` — property changed (skin, speed, etc.)
  - `spine:event` — animation lifecycle events (start, complete, end, interrupt, dispose, event)
  - `atlas:loaded` — emitted after parse; AtlasInspector refreshes
  - `viewport:reset` — recenters and resets zoom
  - `mode:change` — single ↔ comparison; `comparison:projects-changed` — compare project list changed
  - `playback:paused-changed` — pause state changed elsewhere (Space / scrub / frame-step); panels sync their pause button
  - `pose:reset` — Reset Pose ran (button or `R`); panels drop the stale active-animation chip
  - `loop:toggle-current` / `loop:toggle-all` — keyboard loop toggles (`L` / `Shift+L`)
  - `toast` — generic `{ message, type? }` channel; App shows a toast
  - `viewport:zoom` — set viewport zoom from the VIEW slider (kept in sync with wheel via `viewport:change`)
  - `reference:image` / `reference:opacity` — reference/mockup image behind the skeleton
  - `onion:toggle` / `onion:config` — onion-skin enable + `{ before, after, step }`
- **`StateManager`** holds canonical state; mutations emit events via EventBus

### File loading pipeline
```
FileLoader.loadSpineFiles(files)        → SpineFileSet
SpineVersionDetector.detect(fileSet)    → version info (4.1/4.2/unknown)
SpineParser.parseSpineFiles(fileSet)    → { skeletonData, atlas, projectName }
SpineManager.createSpine(projectName)   → SpineElement (added to viewport.wrapper)
StateManager.setProjectA(project)       → EventBus 'project:change'
→ all panels refresh()
```

**Caching**: `SpineParser` stores parsed data in pixi-ext's `Cache` under key `projectName` (skeleton) and `projectName + 'Atlas'` (atlas). `SpineElement` looks up by `projectName` on construction.

**Archive support**: `.spine` files are JSZip archives; `FileLoader` extracts skeleton, atlas, and texture files before passing to the pipeline.

**Binary format**: `SpineVersionDetector` reads varint-encoded headers from `.skel` files to detect version without full parse.

### Spine rendering
- **`Viewport`** stage hierarchy: `stage → gridGraphics (zIndex -1000) → wrapper (Container)`. SpineElement is added to `wrapper`.
- Pan/zoom manipulates `wrapper` transform. Wheel zoom clamped to 0.05–10×.
- `SpineManager` wraps SpineElement API: `setAnimation`, `addAnimation` (queuing), `setAnimationsList`, `setSkin`, `setSkins` (combine N skins into one — 4.2), `setSpeed`, `setPaused`, `setScale`, `setFlip`, `setDefaultMix` (crossfade duration), `resetPose` (clears all tracks, then setup pose — so it isn't immediately re-applied), `clearTrack`, `seekToPaused`/`stepFrame` (scrub & frame-step while paused), `cloneSpine` (detached copy for ghosts/stress-test), `setDebugOptions` (drives `SkeletonDebug`), and `profile()` (memoized static cost analysis).
- **Track time**: looping tracks report `trackTime % duration`; finished one-shots clamp at `duration` (matching `AnimationState.getAnimationTime`) so progress bars freeze instead of cycling.

### Performance & animator tooling
- **`AnimationProfiler`** (`src/services/AnimationProfiler.ts`) — static, machine-independent cost analysis of `SkeletonData`. Duck-types timelines/attachments (works across 4.1/4.2, survives minification) to attribute cost drivers per animation → `OK`/`Watch`/`Heavy`. Includes **deep clipping analysis** (per-mask vertex count, convexity, clipped slot/triangle counts) and **Spine Metrics parity** (bones, timelines, vertex transforms, constraints). Exposed via `SpineManager.profile()` (memoized, reset on load).
- **`PerfSampler`** (`src/services/PerfSampler.ts`) — records peak render cost (draw calls, frame-time fallback) per timeline bucket, per animation. Fed each frame by `App.sampleFrameCost`; drives the scrubber heatmap.
- **`SkeletonDebug`** (`src/services/SkeletonDebug.ts`) — our own debug overlay (bones/meshes/bounds/regions/clipping/paths). Draws from world vertices via duck-typing — **no `instanceof`** — so every flag works regardless of spine-runtime copy duplication (the bundled `SpineDebugRenderer` only drew bones because its `instanceof` checks failed across module copies). Parented to the spine; redrawn each frame from `SpineManager`'s ticker callback.
- **`OnionSkin`** (`src/services/OnionSkin.ts`) — ghost poses before/after the current frame (clone spines via `cloneSpine`, set to offset trackTimes). Opt-in via the ONION SKIN panel section.
- **`StressTest`** (`src/services/StressTest.ts`) — tiles N skeleton clones to find the FPS ceiling; driven by the STRESS TEST slider in the Perf HUD.
- **Surfaces**: severity dots in `QuickAccessPanel`'s animation list, the **Profiler** right tab (`ProfilerPanel`) with per-mask clipping breakdown, the timeline heatmap in the single-mode tracks bar, and the live **Perf HUD** (`PerformancePanel`, DOM-throttled to ~5 Hz).
- **Reference image**: `Viewport.setReferenceImage` draws a world-space mockup behind the skeleton (VIEW section controls; routed via `reference:image`/`reference:opacity` events).

### UI panels
All panels follow the same pattern:
```typescript
class XyzPanel {
  element: HTMLElement;  // mounted by Layout
  constructor(deps) { this.build(); eventBus.on('project:change', () => this.refresh()); }
  private build() { /* static DOM */ }
  refresh() { /* repopulate dynamic data */ }
}
```
- **Right tabs** (`App.buildPanels`): Inspect (SkeletonInspector), Atlas, Slots (PlaceholderPanel), Profiler (ProfilerPanel), Events (debug log), Compare
- **Left panel**: `QuickAccessPanel` in single mode; `ComparisonControlPanel` in compare mode (toggled by `mode:change`). QuickAccessPanel sections: animations (w/ severity dots), skins (single-select + Combine toggle), playback (loop off by default), queue, event triggers, VIEW (zoom slider mirroring wheel + Mix/crossfade + reference image), DEBUG DRAW, ONION SKIN.
- **Tracks bar** (below the viewport): a shared **`TrackBar`** component (`src/ui/panels/TrackBar.ts`) driven by a `TrackController`. `ActiveTracksBar` (single mode) wires it to `SpineManager` and enables scrub/frame-step/heatmap; `CompareTracksBar` wires it to `ComparisonPanel` (no scrub/heatmap). Heatmap CSS lives under `.sv-track-row-progress--heat` in `layout.css`.
- **`PlaceholderPanel`**: slot accessibility badges, copy-name buttons, and text/image overlays positioned by a single shared rAF follow-loop (one loop total, not one per marker).
- **`TreeView`** (`src/ui/TreeView.ts`): reusable, searchable, collapsible tree; `setData(nodes)` replaces content
- **`SkeletonIntrospector`** converts `SkeletonData` → `TreeNode[]` hierarchies for the left panel
- Note: `AnimationPanel.ts` was removed — `QuickAccessPanel` is the live animation/skin UI.

### Comparison mode
`ComparisonEngine` computes diffs (animations/skins/slots/bones only in A or B) and has sync methods (`syncAnimation`, `syncSkin`, `syncSpeed`, `syncPause`). It also computes an attachment-level **`getReskinDiff`** (Reskin Overview) — per `slot / attachment`, which attachments are missing on either side and which resolve to a different atlas region or type — rendered as a collapsible section in the Compare tab with severity badges. The infrastructure supports `projectA` + `projectB` in state, though the UI surfaces this only in the Compare tab.

## Key conventions
- CSS custom properties use `--sv-*` prefix (`src/styles/variables.css`)
- Spine files are parsed manually — **do not** use pixi-ext's URL-based loaders
- Track 0 is the primary animation track; up to 12 tracks (0–11) are supported simultaneously
- **No auto-play on load** — a loaded skeleton stays in setup pose until the user picks an animation. **Loop is off by default** (one-shot).
- Keyboard shortcuts: `Space` pause, `R` reset pose (clears tracks), `←`/`→` frame step, `L`/`Shift+L` loop current/all, `+/-` zoom, `0` reset view
