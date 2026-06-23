import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
    base: '/spine-viewer/',
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'src'),
        },
        // Force a SINGLE copy of the spine runtime. SpineElement (from pixi-ext)
        // and SpineDebugRenderer (from spine-pixi-v7) must share the same
        // spine-core classes, otherwise the renderer's `instanceof MeshAttachment`
        // / RegionAttachment / ClippingAttachment / PathAttachment checks fail
        // against attachments created by the other copy — so only bone debug
        // (which uses no instanceof) draws. See DEBUG DRAW.
        dedupe: [
            '@esotericsoftware/spine-core',
            '@esotericsoftware/spine-pixi-v7',
            'pixi.js',
        ],
    },
    optimizeDeps: {
        // Pre-bundle these together so dev mode also shares one spine-core copy.
        include: [
            '@electricelephants/pixi-ext',
            '@esotericsoftware/spine-pixi-v7',
            '@esotericsoftware/spine-core',
        ],
    },
    build: {
        outDir: 'docs',
        sourcemap: true,
        rollupOptions: {
            output: {
                entryFileNames: 'assets/[name].js',
                chunkFileNames: 'assets/[name].js',
                assetFileNames: 'assets/[name].[ext]',
            },
        },
    },
    server: {
        host: '0.0.0.0', // accessible on LAN for QA team
        port: 5173,
    },
});
