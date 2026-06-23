import { eventBus } from '../../core/EventBus';
import type { ComparisonPanel } from './ComparisonPanel';
import { TrackBar, type TrackController } from './TrackBar';

/**
 * Comparison-mode tracks bar — routes playback through ComparisonPanel so every
 * loaded project stays in sync. No scrub/step/heatmap (ambiguous across N spines).
 */
export class CompareTracksBar {
    private bar: TrackBar;

    constructor(mountPoint: HTMLElement, private comparisonPanel: ComparisonPanel) {
        const master = () => this.comparisonPanel.getProjects()[0]?.manager ?? null;

        const controller: TrackController = {
            getAnimationNames: () => {
                const set = new Set<string>();
                this.comparisonPanel.getProjects().forEach(p => p.manager.getAnimationNames().forEach(a => set.add(a)));
                return [...set];
            },
            getActiveTracks: () => master()?.getAllActiveTracks() ?? [],
            getSpeed: () => master()?.getSpeed?.() ?? 1,
            setAnimation: (i, n, l) => this.comparisonPanel.playAnimation(n, i, l),
            setTrackLoop: (i, l) => this.comparisonPanel.setTrackLoop(i, l),
            clearTrack: (i) => this.comparisonPanel.clearTrack(i),
            getTrackInfo: (i) => master()?.getCurrentTrackInfo(i) ?? null,
        };

        this.bar = new TrackBar(mountPoint, controller);
        this.bar.setVisible(false);

        eventBus.on('mode:change', (mode: string) => {
            if (mode === 'comparison') {
                this.bar.setVisible(true);
                this.bar.start();
            } else {
                this.bar.setVisible(false);
                this.bar.stop();
                this.bar.clear();
            }
        });

        eventBus.on('comparison:projects-changed', () => this.bar.clear());
    }
}
