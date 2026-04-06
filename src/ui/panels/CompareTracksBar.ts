import { eventBus } from '../../core/EventBus';
import type { ComparisonPanel } from './ComparisonPanel';

interface TrackRowElements {
    row: HTMLElement;
    animSelect: HTMLSelectElement;
    progressFill: HTMLElement;
    timeEl: HTMLElement;
    loopBtn: HTMLElement;
    speedEl: HTMLElement;
}

/**
 * Tracks bar for comparison mode — mirrors ActiveTracksBar but routes all
 * playback changes through ComparisonPanel so every loaded project stays in sync.
 */
export class CompareTracksBar {
    private inner: HTMLElement;
    private emptyMsg: HTMLElement;
    private trackRows = new Map<number, TrackRowElements>();
    private statusInterval: ReturnType<typeof setInterval> | null = null;

    constructor(
        mountPoint: HTMLElement,
        private comparisonPanel: ComparisonPanel,
    ) {
        this.inner = document.createElement('div');
        this.inner.className = 'sv-tracks-bar-inner';
        this.inner.style.display = 'none';
        mountPoint.appendChild(this.inner);

        this.emptyMsg = document.createElement('div');
        this.emptyMsg.className = 'sv-tracks-bar-empty';
        this.emptyMsg.textContent = 'No active tracks';
        this.inner.appendChild(this.emptyMsg);

        eventBus.on('mode:change', (mode: string) => {
            if (mode === 'comparison') {
                this.inner.style.display = '';
                this.startUpdates();
            } else {
                this.inner.style.display = 'none';
                this.stopUpdates();
                this.clear();
            }
        });

        eventBus.on('comparison:projects-changed', () => this.clear());
    }

    private clear(): void {
        for (const [, row] of this.trackRows) row.row.remove();
        this.trackRows.clear();
        this.emptyMsg.style.display = '';
    }

    private startUpdates(): void {
        if (this.statusInterval !== null) return;
        this.statusInterval = setInterval(() => this.update(), 150);
    }

    private stopUpdates(): void {
        if (this.statusInterval !== null) {
            clearInterval(this.statusInterval);
            this.statusInterval = null;
        }
    }

    private update(): void {
        const projects = this.comparisonPanel.getProjects();
        if (projects.length === 0) {
            this.clear();
            return;
        }

        const masterManager = projects[0].manager;
        const tracks = masterManager.getAllActiveTracks();
        const activeIndices = new Set(tracks.map(t => t.trackIndex));

        for (const [idx, rowData] of this.trackRows) {
            if (!activeIndices.has(idx)) {
                rowData.row.remove();
                this.trackRows.delete(idx);
            }
        }

        if (tracks.length === 0) {
            this.emptyMsg.style.display = '';
            return;
        }

        this.emptyMsg.style.display = 'none';

        // Union of all animation names across projects
        const allAnims = new Set<string>();
        projects.forEach(p => p.manager.getAnimationNames().forEach(a => allAnims.add(a)));
        const animNames = [...allAnims];

        const speed = masterManager.getSpeed?.() ?? 1;

        for (const t of tracks) {
            const pct = t.duration > 0 ? Math.min(100, (t.time / t.duration) * 100) : 0;

            if (this.trackRows.has(t.trackIndex)) {
                const r = this.trackRows.get(t.trackIndex)!;
                r.progressFill.style.width = `${pct}%`;
                r.timeEl.textContent = t.loop
                    ? `${t.time.toFixed(1)}s \u221E`
                    : `${t.time.toFixed(1)}s / ${t.duration.toFixed(1)}s`;
                r.loopBtn.textContent = t.loop ? '\u221E' : '1\u00D7';
                r.loopBtn.title = t.loop ? 'Looping (click: play once)' : 'Play once (click: loop)';
                if (r.animSelect.value !== t.name) r.animSelect.value = t.name;
                r.speedEl.textContent = `${speed.toFixed(1)}x`;
            } else {
                this.createRow(t, pct, animNames, speed);
            }
        }
    }

    private createRow(
        t: { trackIndex: number; name: string; time: number; duration: number; loop: boolean },
        pct: number,
        animNames: string[],
        speed: number,
    ): void {
        const row = document.createElement('div');
        row.className = 'sv-track-row';

        const badge = document.createElement('span');
        badge.className = 'sv-track-row-badge';
        badge.textContent = `T${t.trackIndex}`;
        row.appendChild(badge);

        const animSelect = document.createElement('select');
        animSelect.className = 'sv-select sv-track-row-select';
        animNames.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            animSelect.appendChild(opt);
        });
        animSelect.value = t.name;
        animSelect.addEventListener('change', () => {
            const current = this.comparisonPanel.getProjects()[0]?.manager.spine?.state?.getCurrent(t.trackIndex);
            const loop = current?.loop ?? t.loop;
            this.comparisonPanel.playAnimation(animSelect.value, t.trackIndex, loop);
        });
        row.appendChild(animSelect);

        const loopBtn = document.createElement('button');
        loopBtn.className = 'sv-track-row-btn';
        loopBtn.textContent = t.loop ? '\u221E' : '1\u00D7';
        loopBtn.title = t.loop ? 'Looping (click: play once)' : 'Play once (click: loop)';
        loopBtn.addEventListener('click', () => {
            const current = this.comparisonPanel.getProjects()[0]?.manager.spine?.state?.getCurrent(t.trackIndex);
            if (current) {
                this.comparisonPanel.setTrackLoop(t.trackIndex, !current.loop);
            }
        });
        row.appendChild(loopBtn);

        const progWrap = document.createElement('div');
        progWrap.className = 'sv-track-row-progress';
        const fill = document.createElement('div');
        fill.className = 'sv-track-row-progress-fill';
        fill.style.width = `${pct}%`;
        progWrap.appendChild(fill);
        row.appendChild(progWrap);

        const timeEl = document.createElement('span');
        timeEl.className = 'sv-track-row-time';
        timeEl.textContent = t.loop
            ? `${t.time.toFixed(1)}s \u221E`
            : `${t.time.toFixed(1)}s / ${t.duration.toFixed(1)}s`;
        row.appendChild(timeEl);

        const speedEl = document.createElement('span');
        speedEl.className = 'sv-track-row-speed';
        speedEl.textContent = `${speed.toFixed(1)}x`;
        row.appendChild(speedEl);

        const stopBtn = document.createElement('button');
        stopBtn.className = 'sv-track-row-btn sv-track-row-stop';
        stopBtn.textContent = '\u25A0';
        stopBtn.title = `Stop track ${t.trackIndex}`;
        stopBtn.addEventListener('click', () => {
            this.comparisonPanel.clearTrack(t.trackIndex);
            row.remove();
            this.trackRows.delete(t.trackIndex);
            if (this.trackRows.size === 0) this.emptyMsg.style.display = '';
        });
        row.appendChild(stopBtn);

        this.inner.appendChild(row);
        this.trackRows.set(t.trackIndex, { row, animSelect, progressFill: fill, timeEl, loopBtn, speedEl });
    }
}
