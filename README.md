# ArtStudio PWA

A responsive, local-first drawing application starter inspired by professional digital painting workflows. This is an original implementation and is not affiliated with or a copy of Procreate.

## Features in this starter

- Responsive desktop, tablet, and phone workspace
- Brush and eraser tools
- Pointer input with basic stylus-pressure response where supported
- Brush size, opacity, color, and stroke stabilization controls
- Layer creation, naming, visibility, opacity, ordering, and blend modes
- Undo/redo snapshots for the active layer
- Canvas presets up to 8192 × 8192 (large presets may exceed device memory)
- Local autosave/recovery using IndexedDB
- PNG export and editable ArtStudio JSON project import/export
- PWA manifest and service worker for offline app-shell caching

## Run locally

Requires Node.js 20+ recommended.

```bash
npm install
npm run dev
```

Open the URL Vite prints. For a production build:

```bash
npm run build
npm run preview
```

PWA service-worker registration is enabled in production builds. For local testing, use the Vite dev server for the app and a production preview to test offline behavior.

## Important limitations

This is a working starter/MVP, not a complete Procreate replacement yet. It does **not** currently implement a production-grade GPU/WebGL brush engine, full brush studio, PSD compatibility, animation timeline, smudge/paint mixing, liquify, selection/transform tools, or robust large-document tiling. The current canvas renderer uses stacked HTML canvases and 2D contexts. These advanced systems need to be implemented and tested in subsequent milestones.

Browser pressure/tilt data and palm-rejection behavior vary by device and browser. The app cannot guarantee identical stylus behavior across platforms. The current autosave stores PNG snapshots in IndexedDB; large multi-layer documents may consume significant storage. Export important artwork regularly.

## Suggested next milestones

1. Add a tested document model and robust autosave/version recovery.
2. Move strokes to a command-based history system instead of full-canvas snapshots.
3. Add proper canvas zoom/pan/rotation and fit-to-screen behavior.
4. Implement brush presets, pressure curves, tilt, texture stamps, and brush editor.
5. Add selection/transform, fill, symmetry, guides, and reference images.
6. Build a tile-based GPU renderer with WebGL fallback strategy.
7. Add frame-by-frame animation and export.
8. Add import/export format validation and device/browser test coverage.
