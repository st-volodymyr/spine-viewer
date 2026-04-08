import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
    base: '/spine-viewer/',
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'src'),
        },
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
