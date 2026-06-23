import { eventBus } from '../../core/EventBus';
import type { StateManager } from '../../core/StateManager';
import type { SpineManager } from '../../core/SpineManager';
import type { PerfSampler } from '../../services/PerfSampler';
import { TrackBar, type TrackController } from './TrackBar';

/**
 * Single-mode tracks bar below the viewport. Thin host that wires the shared
 * TrackBar to the SpineManager and exposes scrub / frame-step / heatmap.
 */
export class ActiveTracksBar {
    private bar: TrackBar;

    constructor(
        mountPoint: HTMLElement,
        private stateManager: StateManager,
        private spineManager: SpineManager,
        private sampler: PerfSampler,
    ) {
        const controller: TrackController = {
            getAnimationNames: () => this.stateManager.projectA?.animationNames ?? [],
            getActiveTracks: () => this.spineManager.getAllActiveTracks(),
            getSpeed: () => this.spineManager.getSpeed?.() ?? 1,
            setAnimation: (i, n, l) => { this.spineManager.setAnimation(i, n, l); },
            setTrackLoop: (i, l) => this.spineManager.setTrackLoop(i, l),
            clearTrack: (i) => this.spineManager.clearTrack(i),
            getTrackInfo: (i) => this.spineManager.getCurrentTrackInfo(i),
            seekToPaused: (i, t) => this.spineManager.seekToPaused(i, t),
            stepFrame: (i, d) => this.spineManager.stepFrame(i, d),
            onPause: () => {
                this.stateManager.updateProjectA({ paused: true });
                const btn = document.getElementById('sv-pause-btn');
                if (btn) btn.textContent = 'Resume';
                eventBus.emit('playback:paused-changed', true);
            },
            getHeat: (name) => this.sampler.getHeat(name),
        };

        this.bar = new TrackBar(mountPoint, controller);

        eventBus.on('project:change', () => {
            this.bar.clear();
            if (this.stateManager.mode !== 'comparison') this.bar.start();
        });

        eventBus.on('mode:change', (mode: string) => {
            const single = mode !== 'comparison';
            this.bar.setVisible(single);
            if (single) this.bar.start();
            else this.bar.stop();
        });
    }
}
