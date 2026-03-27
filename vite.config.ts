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
        outDir: 'dist',
        sourcemap: true,
    },
    server: {
        host: '0.0.0.0', // accessible on LAN for QA team
        port: 5173,
    },
});
