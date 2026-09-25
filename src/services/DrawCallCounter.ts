/**
 * Counts WebGL draw calls per rendered frame. PixiJS 7 does not track this
 * itself, so we wrap the context's draw entry points and latch the count on
 * the renderer's `postrender` runner. `last` is the previous completed frame
 * (the ticker runs before render), or null on a non-WebGL renderer.
 */
export class DrawCallCounter {
    private current = 0;
    private latched: number | null = null;

    constructor(renderer: unknown) {
        const r = renderer as any;
        const gl = r?.gl as WebGLRenderingContext | undefined;
        if (!gl || !r.runners?.postrender) return;

        const wrap = (name: string) => {
            const orig = (gl as any)[name];
            if (typeof orig !== 'function') return;
            (gl as any)[name] = (...args: unknown[]) => {
                this.current++;
                return orig.apply(gl, args);
            };
        };
        ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced'].forEach(wrap);

        r.runners.postrender.add({
            postrender: () => {
                this.latched = this.current;
                this.current = 0;
            },
        });
        this.latched = 0;
    }

    get last(): number | null {
        return this.latched;
    }
}
