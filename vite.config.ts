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
});
