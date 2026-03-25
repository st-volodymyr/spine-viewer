# Spine Animation Viewer

## Overview
A modern web-based Spine animation viewer/reviewer built with PixiJS 7 and @electricelephants/pixi-ext. Supports Spine 4.1/4.2, skeleton inspection, atlas inspection, placeholders, animation sequencing, and multi-project comparison.

## Tech Stack
- **Runtime**: Vite + TypeScript (vanilla, no UI framework)
- **Rendering**: PixiJS 7.4.x via `@electricelephants/pixi-ext@1.1.17`
- **Spine**: `@esotericsoftware/spine-pixi-v7` (4.2 runtime, bundled in pixi-ext)
- **Archive support**: JSZip for `.spine` files
- **Deployment**: GitHub Pages (static site)

## Commands
```bash
npm install          # Install dependencies
npm run dev          # Start dev server
npm run build        # Build for production (output: dist/)
npm run preview      # Preview production build locally
```

## Project Structure
- `src/core/` — App, StateManager, SpineManager, Viewport
- `src/services/` — FileLoader, SpineParser, SpineVersionDetector, AtlasParser, SkeletonIntrospector, ComparisonEngine
- `src/ui/` — Layout, Panel, TreeView, panels/, controls/
- `src/types/` — TypeScript interfaces
- `src/styles/` — CSS (neutral medium theme)

## Key Dependencies
- `@electricelephants/pixi-ext` — Extended PixiJS 7 with SpineElement, styling system, spine types
  - SpineElement: animation control, track management, skin switching, slot/placeholder interaction
  - Exports: Spine, SkeletonData, Skeleton, AnimationState, Bone, Slot, TrackEntry, etc.
  - Loaders: SpineAtlasLoaderParser, SpineSkeletonLoaderParser (registered automatically)
- `jszip` — Extract .spine archives

## Conventions
- No UI framework — vanilla TypeScript + DOM manipulation
- CSS custom properties for theming (--sv-* prefix)
- EventTarget-based state management
- Files loaded via manual parsing (not pixi-ext URL-based loaders)
