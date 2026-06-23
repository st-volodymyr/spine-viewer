import { eventBus } from '../core/EventBus';
import type { Viewport } from '../core/Viewport';
import type { SpineManager } from '../core/SpineManager';

export interface OnionConfig {
    before: number;  // ghost poses before the current frame
    after: number;   // ghost poses after the current frame
    step: number;    // spacing in frames between ghosts
    fps: number;     // frames-per-second basis for the step
}

interface Ghost {
    spine: any;
    offset: number;  // signed frame offset
}

/**
 * Onion skinning ("Ghosting"): renders translucent copies of the skeleton at
 * timeline offsets before/after the current frame so an animator can judge
 * spacing, timing and motion arcs. Ghosts are extra detached spines sharing the
 * cached skeleton data; opt-in (it costs extra draw calls). Single-mode only.
 */
export class OnionSkin {
    private ghosts: Ghost[] = [];
    private enabled = false;
    private cfg: OnionConfig = { before: 2, after: 2, step: 3, fps: 30 };

    constructor(private viewport: Viewport, private spineManager: SpineManager) {
        this.viewport.ticker.add(() => this.tick());
        eventBus.on('project:change', () => this.rebuild());
        eventBus.on('onion:toggle', (on: boolean) => { this.enabled = on; this.rebuild(); });
        eventBus.on('onion:config', (partial: Partial<OnionConfig>) => { Object.assign(this.cfg, partial); this.rebuild(); });
    }

    private clearGhosts(): void {
        for (const g of this.ghosts) { g.spine.parent?.removeChild(g.spine); g.spine.destroy(); }
        this.ghosts = [];
    }

    private rebuild(): void {
        this.clearGhosts();
        const main = this.spineManager.spine;
        if (!this.enabled || !main) return;

        const offsets: number[] = [];
        for (let i = this.cfg.before; i >= 1; i--) offsets.push(-i * this.cfg.step);
        for (let i = 1; i <= this.cfg.after; i++) offsets.push(i * this.cfg.step);

        const currentSkin = (main.skeleton.skin as any)?.name ?? null;

        for (const off of offsets) {
            const clone = this.spineManager.cloneSpine();
            if (!clone) return; // runtime can't clone (e.g. nothing loaded) — bail quietly
            clone.autoUpdate = false;
            clone.zIndex = -10;          // behind the main spine (zIndex 0)
            clone.alpha = 0.28;
            if (currentSkin) {
                try { clone.skeleton.setSkinByName(currentSkin); clone.skeleton.setSlotsToSetupPose(); } catch { /* skin missing */ }
            }
            this.viewport.wrapper.addChild(clone);
            this.ghosts.push({ spine: clone, offset: off });
        }
    }

    private tick(): void {
        if (!this.enabled || this.ghosts.length === 0) return;
        const main = this.spineManager.spine;
        const info = this.spineManager.getCurrentTrackInfo(0);
        if (!main || !info) {
            for (const g of this.ghosts) g.spine.visible = false;
            return;
        }
        const stepSec = 1 / this.cfg.fps;
        for (const g of this.ghosts) {
            const sp = g.spine;
            sp.visible = true;
            // Keep the ghost aligned with the main spine's transform.
            sp.position.set(main.x, main.y);
            sp.scale.set(main.scale.x, main.scale.y);
            const state: any = sp.state;
            const cur = state.getCurrent(0);
            if (!cur || cur.animation?.name !== info.name) {
                state.setAnimation(0, info.name, false);
            }
            const entry = state.getCurrent(0);
            if (entry) entry.trackTime = Math.max(0, Math.min(info.time + g.offset * stepSec, info.duration));
            (sp as any).update(0);
        }
    }
}
