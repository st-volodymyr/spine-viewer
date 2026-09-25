import { eventBus } from '../../core/EventBus';
import type { ComparisonPanel } from './ComparisonPanel';
import { TrackBar, type TrackController, type TrackInfo } from './TrackBar';

/**
 * Comparison-mode tracks bar — a shared timeline: playback, scrub and frame-step
 * go through ComparisonPanel to every project, at the same absolute time (so
 * versions with different durations line up frame by frame). No heatmap.
 */
export class CompareTracksBar {
    private bar: TrackBar;

    constructor(mountPoint: HTMLElement, private comparisonPanel: ComparisonPanel) {
        const managers = () => this.comparisonPanel.getProjects().map(p => p.manager);
        // A track index is shown if ANY project plays it (the first project may lack
        // an animation that only exists in another one); first project wins per index.
        const activeTracks = () => {
            const byIndex = new Map<number, TrackInfo>();
            for (const m of managers()) {
                for (const t of m.getAllActiveTracks()) {
                    if (!byIndex.has(t.trackIndex)) byIndex.set(t.trackIndex, t);
                }
            }
            return [...byIndex.values()].sort((a, b) => a.trackIndex - b.trackIndex);
        };

        const controller: TrackController = {
            getAnimationNames: () => {
                const set = new Set<string>();
                this.comparisonPanel.getProjects().forEach(p => p.manager.getAnimationNames().forEach(a => set.add(a)));
                return [...set];
            },
            getActiveTracks: activeTracks,
            getSpeed: () => managers()[0]?.getSpeed?.() ?? 1,
            setAnimation: (i, n, l) => this.comparisonPanel.playAnimation(n, i, l),
            setTrackLoop: (i, l) => this.comparisonPanel.setTrackLoop(i, l),
            clearTrack: (i) => this.comparisonPanel.clearTrack(i),
            getTrackInfo: (i) => activeTracks().find(t => t.trackIndex === i) ?? null,
            seekToPaused: (i, t) => this.comparisonPanel.seekAll(i, t),
            stepFrame: (i, d) => this.comparisonPanel.stepAll(i, d),
            onPause: () => eventBus.emit('compare:paused-changed', true),
            getEventMarkers: (name) => managers().find(m => m.getAnimationNames().includes(name))?.getEventKeys(name) ?? [],
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
