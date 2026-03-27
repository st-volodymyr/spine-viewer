# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview
A web-based Spine animation viewer/reviewer built with PixiJS 7 and `@electricelephants/pixi-ext`. Supports Spine 4.1/4.2 (JSON + binary), skeleton/atlas inspection, animation sequencing, placeholders, and multi-project A/B comparison.

## Commands
```bash
npm run dev          # Start dev server
npm run build        # tsc + vite build → dist/
npm run preview      # Serve production build locally
```
No test runner or linter is configured.

## Tech Stack
- **Vite + TypeScript** (strict, ES2020, path alias `@/*` → `src/*`)
- **PixiJS 7.4.x** via `@electricelephants/pixi-ext@1.1.17` — provides `SpineElement`, spine type exports, and auto-registered atlas/skeleton loaders
- **`@esotericsoftware/spine-pixi-v7`** (4.2 runtime, bundled inside pixi-ext)
- **JSZip** for `.spine` archive extraction
- **`@types/node`** dev dependency — required for `path` and `__dirname` in `vite.config.ts`
- **Deployment**: GitHub Pages (`base: '/spine-viewer/'` in vite.config)
- **tsconfig.json** `include` covers `src/**/*.ts` + `vite.config.ts` (so the IDE TS server types the config file correctly)

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
- `SpineManager` wraps SpineElement API: `setAnimation`, `addAnimation` (queuing), `setSkin`, `setSpeed`, `setPaused`, `setScale`, `setFlip`, `resetPose`, `clearTrack`.

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
- **Right tabs**: Animation, Properties, Placeholders, Events (debug log), Compare
- **Left panel**: SkeletonInspector (bones/slots/skins/events/animations/constraints as TreeView), AtlasInspector
- **`TreeView`** (`src/ui/TreeView.ts`): reusable, searchable, collapsible tree; `setData(nodes)` replaces content
- **`SkeletonIntrospector`** converts `SkeletonData` → `TreeNode[]` hierarchies for the left panel

### Comparison mode
`ComparisonEngine` computes diffs (animations/skins/slots/bones only in A or B) and has sync methods (`syncAnimation`, `syncSkin`, `syncSpeed`, `syncPause`). The infrastructure supports `projectA` + `projectB` in state, though the UI surfaces this only in the Compare tab.

## Key conventions
- CSS custom properties use `--sv-*` prefix (`src/styles/variables.css`)
- Spine files are parsed manually — **do not** use pixi-ext's URL-based loaders
- Track 0 is the primary animation track; up to 12 tracks (0–11) are supported simultaneously
- Keyboard shortcuts: `Space` pause, `R` reset pose, `+/-` zoom, `0` reset view
