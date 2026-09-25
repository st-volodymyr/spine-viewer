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
  - `viewport:fit` — fit-to-view (`F`, canvas ⛶ button, auto on load); App `fitToView` frames `SpineManager.getFitBounds()` (union over compare projects in compare mode) via `Viewport.fitRect`
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
- **Fit bounds** (`SpineManager.getFitBounds`): current pose while something plays; in setup pose, the union of the setup pose and poses sampled across all animations on a detached clone. Uses `visibleSkeletonBounds` — duck-typed region/mesh AABB that skips alpha-0 slots (hidden pop-ups/glows), NOT `Skeleton.getBounds`; it frames normal-blend ("solid") slots first, since additive rays/glows often scale to full-screen size, falling back to all visible slots. `getFitBounds(layoutAnims)` gives frame-independent bounds for layout (setup pose + those animations; else what the skeleton plays; else all).
- `SpineManager` wraps SpineElement API: `setAnimation`, `addAnimation` (queuing), `setAnimationsList`, `setSkin`, `setSkins` (combine N skins into one — 4.2), `setSpeed`, `setPaused`, `setScale`, `setFlip`, `setDefaultMix` (crossfade duration), `resetPose` (clears all tracks, then setup pose — so it isn't immediately re-applied), `clearTrack`, `seekToPaused`/`stepFrame` (scrub & frame-step while paused), `cloneSpine` (detached copy for ghosts/stress-test), `setDebugOptions` (drives `SkeletonDebug`), and `profile()` (memoized static cost analysis).
- **Track time**: looping tracks report `trackTime % duration`; finished one-shots clamp at `duration` (matching `AnimationState.getAnimationTime`) so progress bars freeze instead of cycling.

### Performance & animator tooling
- **`AnimationProfiler`** (`src/services/AnimationProfiler.ts`) — static, machine-independent cost analysis of `SkeletonData`. Duck-types timelines/attachments (works across 4.1/4.2, survives minification) to attribute cost drivers per animation → `OK`/`Watch`/`Heavy`. Includes **deep clipping analysis** (per-mask vertex count, convexity, clipped slot/triangle counts) and **Spine Metrics parity** (bones, timelines, vertex transforms, constraints). Exposed via `SpineManager.profile()` (memoized, reset on load).
- **`DrawCallCounter`** (`src/services/DrawCallCounter.ts`) — PixiJS 7 has no draw-call stat, so we wrap `gl.drawElements/drawArrays(+Instanced)` and latch the count on the renderer's `postrender` runner. `Viewport.drawCalls.last` = previous frame's count (whole stage); used by the Perf HUD, slow-frame log and heatmap.
- **`PerfSampler`** (`src/services/PerfSampler.ts`) — per animation, per timeline bucket: peak draw calls (relative scale with a minimum spread, so 4 vs 5 calls never reads red), or — only if draw calls are unavailable — mean frame time on an absolute 18→40 ms scale. Fed each frame by `App.sampleFrameCost`; drives the scrubber heatmap + its legend (`getLegend`, shown as `.sv-track-row-heatkey`).
- **`SkeletonDebug`** (`src/services/SkeletonDebug.ts`) — our own debug overlay (bones/meshes/bounds/regions/clipping/paths). Draws from world vertices via duck-typing — **no `instanceof`** — so every flag works regardless of spine-runtime copy duplication (the bundled `SpineDebugRenderer` only drew bones because its `instanceof` checks failed across module copies). Parented to the spine; redrawn each frame from `SpineManager`'s ticker callback.
- **`OnionSkin`** (`src/services/OnionSkin.ts`) — ghost poses before/after the current frame (clone spines via `cloneSpine`, set to offset trackTimes). Opt-in via the ONION SKIN panel section.
- **`StressTest`** (`src/services/StressTest.ts`) — tiles N skeleton clones to find the FPS ceiling; driven by the STRESS TEST slider in the Perf HUD.
- **Surfaces**: severity dots in `QuickAccessPanel`'s animation list, the **Profiler** right tab (`ProfilerPanel`) with per-mask clipping breakdown, the timeline heatmap in the single-mode tracks bar, and the live **Perf HUD** (`PerformancePanel`, DOM-throttled to ~5 Hz).
- **`EventKeys`** (`src/services/EventKeys.ts`) — static event keyframes per animation (duck-typed EventTimelines), memoized via `SpineManager.getEventKeys/getAllEventKeys`. Drives the **Event Keys** table in the Events tab (Playing/All scope, filter, click-to-seek, flash on fire; `SpineEventData.eventTime` matches fired events to keys) and event ticks on the single-mode track groove (`TrackController.getEventMarkers`).
- **`QueuePlayer`** (`src/services/QueuePlayer.ts`) — animation-queue sequencer with repeat modes `once` / `last` (loop last) / `all` (whole list re-queued when the last entry starts); per-entry listeners report the current index/cycle and detect when something else takes over the track. UI: ANIMATION QUEUE section (pick-to-add select, drag reorder, Play/Stop, played/current highlighting).
- **`FrameLog`** (`src/services/FrameLog.ts`) — slow-frame (threshold 20/33/50 ms, with track/draw-call context) + `longtask` log shown in the Perf HUD "Slow frames" section (copy as TSV).
- **Origin crosshair** — `origin` flag of `SkeletonDebug`/`DebugDrawOptions` (DEBUG DRAW → Origin); zoom-compensated axis lines through the skeleton origin.
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
- **Right tabs** (`App.buildPanels`): Inspect (SkeletonInspector — its sub-tabs include **Profiler**, mounted via `addPanelTab`), Atlas, Slots (PlaceholderPanel), Events (debug log), Compare
- **Resizable side panels**: `Layout.buildPanelResizer` adds drag handles on the inner edges of the left/right panels. Widths live in `--sv-left-panel-width` / `--sv-right-panel-width` (set on `<html>`, persisted in `localStorage` as `sv-{side}-panel-width`, double-click resets); `Viewport`'s ResizeObserver re-fits the canvas.
- **Left panel**: `QuickAccessPanel` in single mode; `ComparisonControlPanel` in compare mode (toggled by `mode:change`). QuickAccessPanel: animations (w/ severity dots, filter box when >8), skins (single-select + Combine toggle, filter), playback (loop off by default), then a collapsible **TOOLS** group: queue, event triggers (hidden when the skeleton has no events), VIEW (zoom slider mirroring wheel + Mix/crossfade + reference image), DEBUG DRAW, ONION SKIN — tool sections start collapsed; collapse state persists in `localStorage` (`sv-section-collapsed:<TITLE>`).
- **Tracks bar** (below the viewport): a shared **`TrackBar`** component (`src/ui/panels/TrackBar.ts`) driven by a `TrackController`. `ActiveTracksBar` (single mode) wires it to `SpineManager` and enables scrub/frame-step/heatmap; `CompareTracksBar` wires it to `ComparisonPanel` as a **shared timeline**: scrub / frame-step / event ticks apply to every project at the same absolute time (`seekAll`/`stepAll`), no heatmap. Heatmap CSS lives under `.sv-track-row-progress--heat` in `layout.css`.
- **`PlaceholderPanel`**: slot accessibility badges, copy-name buttons, and text/image overlays positioned by a single shared rAF follow-loop (one loop total, not one per marker).
- **`TreeView`** (`src/ui/TreeView.ts`): reusable, searchable, collapsible tree; `setData(nodes)` replaces content
- **`SkeletonIntrospector`** converts `SkeletonData` → `TreeNode[]` hierarchies for the left panel
- Note: `AnimationPanel.ts` was removed — `QuickAccessPanel` is the live animation/skin UI.

### Comparison mode
**Layout** (`ComparisonPanel.arrangeProjects`): a grid, one cell per project, all at the SAME scale (sizes stay comparable); cell = largest project's layout bounds for the synced animations + padding; column count chosen to best fill the canvas; dashed cell borders; re-fit on add/remove, animation change and `F` (`fitGrid`). The left list groups animations as shared / in some projects (3+) / only in X. Same-named projects get a `#2`/`#3` suffix (`ComparisonPanel.uniqueName`). The diff is pairwise: with 3+ projects a "Diff [A] vs [B]" picker (`diffA`/`diffB`) selects the pair. `CompareTracksBar` merges tracks across all projects (first project wins per index). `ComparisonEngine` computes diffs (animations/skins/slots/bones only in A or B) and has sync methods (`syncAnimation`, `syncSkin`, `syncSpeed`, `syncPause`). It also computes an attachment-level **`getReskinDiff`** (Reskin Overview) — per `slot / attachment`, which attachments are missing on either side and which resolve to a different atlas region or type — rendered as a collapsible section in the Compare tab with severity badges. Deeper diffs for shared content (`getDurationDiff`, `getEventTimingDiff`, `getConstraintDiff`, `getSlotSetupDiff`) render as further sections below it (styles in `src/styles/compare-diff.css`). The infrastructure supports `projectA` + `projectB` in state, though the UI surfaces this only in the Compare tab.

## Key conventions
- CSS custom properties use `--sv-*` prefix (`src/styles/variables.css`); text on `--sv-accent` backgrounds must use `--sv-accent-text` (dark in the dark theme), never `#fff`
- Canvas colour follows the theme (`CANVAS_BG` in `StateManager`) until the user picks their own via the colour input
- Spine files are parsed manually — **do not** use pixi-ext's URL-based loaders
- Track 0 is the primary animation track; up to 12 tracks (0–11) are supported simultaneously
- **No auto-play on load** — a loaded skeleton stays in setup pose until the user picks an animation; nothing is pre-selected in the animation list and no track chip shows until something plays. A `.sv-setup-hint` pill (App `updateSetupHint`) sits at the bottom of the canvas while no track is active ("Setup pose is empty" when the setup-pose bounds are zero). **Loop is off by default** (one-shot).
- Keyboard shortcuts: `Space` pause, `R` reset pose (clears tracks), `←`/`→` frame step, `L`/`Shift+L` loop current/all, `+/-` zoom, `0` reset view, `F` fit to view
