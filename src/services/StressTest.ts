import { eventBus } from '../core/EventBus';
import type { Viewport } from '../core/Viewport';
import type { SpineManager } from '../core/SpineManager';

const SPACING = 160;     // px between tiled clones (world space)
const MAX_CLONES = 200;  // hard cap to avoid locking the tab

/**
 * Multi-instance stress test: tiles N extra copies of the current skeleton, all
 * playing the current animation, so you can find the FPS ceiling ("how many of
 * these can run at 60fps"). Clones share cached data/textures. Single-mode only;
 * watch the Perf HUD (FPS / draw calls) while raising the count.
 */
export class StressTest {
    private clones: any[] = [];

    constructor(private viewport: Viewport, private spineManager: SpineManager) {
        eventBus.on('project:change', () => this.setCount(0));
    }

    get count(): number {
        return this.clones.length;
    }

    setCount(n: number): void {
        const target = Math.max(0, Math.min(MAX_CLONES, Math.floor(n)));
        while (this.clones.length > target) {
            const c = this.clones.pop();
            c.parent?.removeChild(c);
            c.destroy();
        }
        const info = this.spineManager.getCurrentTrackInfo(0);
        const animName = info?.name ?? this.spineManager.getAnimationNames()[0];
        const main = this.spineManager.spine;
        while (this.clones.length < target) {
            const clone = this.spineManager.cloneSpine();
            if (!clone) break; // nothing to clone
            if (main) clone.scale.set(main.scale.x, main.scale.y);
            if (animName) (clone.state as any).setAnimation(0, animName, true);
            this.viewport.wrapper.addChild(clone);
            this.clones.push(clone);
        }
        this.layout();
    }

    /** Tile clones in a centered grid around the origin. */
    private layout(): void {
        const n = this.clones.length;
        if (n === 0) return;
        const cols = Math.ceil(Math.sqrt(n));
        this.clones.forEach((c, i) => {
            const col = i % cols;
            const row = Math.floor(i / cols);
            c.x = (col - (cols - 1) / 2) * SPACING;
            c.y = (row - (Math.ceil(n / cols) - 1) / 2) * SPACING;
        });
    }
}
