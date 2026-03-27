import { eventBus } from '../../core/EventBus';
import type { StateManager } from '../../core/StateManager';
import type { SpineManager } from '../../core/SpineManager';

interface TrackRowElements {
    row: HTMLElement;
    animSelect: HTMLSelectElement;
    progressFill: HTMLElement;
    timeEl: HTMLElement;
    loopBtn: HTMLElement;
    speedEl: HTMLElement;
}

/**
 * Horizontal bar below the viewport showing all active animation tracks.
 * Each track is a full row with animation selector, progress, loop, speed, and stop controls.
 */
export class ActiveTracksBar {
    private container: HTMLElement;
    private inner: HTMLElement;
    private emptyMsg: HTMLElement;
    private trackRows = new Map<number, TrackRowElements>();
    private statusInterval: ReturnType<typeof setInterval> | null = null;

    constructor(
        mountPoint: HTMLElement,
        private stateManager: StateManager,
        private spineManager: SpineManager,
    ) {
        this.container = mountPoint;

        this.inner = document.createElement('div');
        this.inner.className = 'sv-tracks-bar-inner';
        this.container.appendChild(this.inner);

        this.emptyMsg = document.createElement('div');
        this.emptyMsg.className = 'sv-tracks-bar-empty';
        this.emptyMsg.textContent = 'No active tracks';
        this.inner.appendChild(this.emptyMsg);

        eventBus.on('project:change', () => {
            this.clear();
            this.startUpdates();
        });

        eventBus.on('mode:change', (mode: string) => {
            this.container.style.display = mode === 'comparison' ? 'none' : '';
        });
    }

    private clear(): void {
        for (const [, row] of this.trackRows) {
            row.row.remove();
        }
        this.trackRows.clear();
        this.emptyMsg.style.display = '';
    }

    private startUpdates(): void {
        if (this.statusInterval !== null) clearInterval(this.statusInterval);
        this.statusInterval = setInterval(() => this.update(), 150);
    }

    private update(): void {
        const tracks = this.spineManager.getAllActiveTracks();
        const activeIndices = new Set(tracks.map(t => t.trackIndex));

        // Remove rows for stopped tracks immediately
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

        const project = this.stateManager.projectA;
        const animNames = project?.animationNames ?? [];

        for (const t of tracks) {
            const pct = t.duration > 0 ? Math.min(100, (t.time / t.duration) * 100) : 0;

            if (this.trackRows.has(t.trackIndex)) {
                // Update existing row
                const r = this.trackRows.get(t.trackIndex)!;
                r.progressFill.style.width = `${pct}%`;
                r.timeEl.textContent = t.loop
                    ? `${t.time.toFixed(1)}s \u221E`
                    : `${t.time.toFixed(1)}s / ${t.duration.toFixed(1)}s`;
                r.loopBtn.textContent = t.loop ? '\u221E' : '1\u00D7';
                r.loopBtn.title = t.loop ? 'Looping (click: play once)' : 'Play once (click: loop)';
                // Sync animation name if changed externally
                if (r.animSelect.value !== t.name) {
                    r.animSelect.value = t.name;
                }
                // Show current speed
                const speed = this.spineManager.getSpeed?.() ?? 1;
                r.speedEl.textContent = `${speed.toFixed(1)}x`;
            } else {
                // Create new row
                this.createRow(t, pct, animNames);
            }
        }
    }

    private createRow(
        t: { trackIndex: number; name: string; time: number; duration: number; loop: boolean },
        pct: number,
        animNames: string[],
    ): void {
        const row = document.createElement('div');
        row.className = 'sv-track-row';

        // Track badge
        const badge = document.createElement('span');
        badge.className = 'sv-track-row-badge';
        badge.textContent = `T${t.trackIndex}`;
        row.appendChild(badge);

        // Animation select dropdown
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
            const current = (this.spineManager.spine?.state as any)?.getCurrent(t.trackIndex);
            const loop = current?.loop ?? true;
            this.spineManager.setAnimation(t.trackIndex, animSelect.value, loop);
        });
        row.appendChild(animSelect);

        // Loop toggle button
        const loopBtn = document.createElement('button');
        loopBtn.className = 'sv-track-row-btn';
        loopBtn.textContent = t.loop ? '\u221E' : '1\u00D7';
        loopBtn.title = t.loop ? 'Looping (click: play once)' : 'Play once (click: loop)';
        loopBtn.addEventListener('click', () => {
            const current = (this.spineManager.spine?.state as any)?.getCurrent(t.trackIndex);
            if (current) {
                this.spineManager.setTrackLoop(t.trackIndex, !current.loop);
            }
        });
        row.appendChild(loopBtn);

        // Progress bar
        const progWrap = document.createElement('div');
        progWrap.className = 'sv-track-row-progress';
        const fill = document.createElement('div');
        fill.className = 'sv-track-row-progress-fill';
        fill.style.width = `${pct}%`;
        progWrap.appendChild(fill);
        row.appendChild(progWrap);

        // Time
        const timeEl = document.createElement('span');
        timeEl.className = 'sv-track-row-time';
        timeEl.textContent = t.loop
            ? `${t.time.toFixed(1)}s \u221E`
            : `${t.time.toFixed(1)}s / ${t.duration.toFixed(1)}s`;
        row.appendChild(timeEl);

        // Speed display
        const speedEl = document.createElement('span');
        speedEl.className = 'sv-track-row-speed';
        const speed = this.spineManager.getSpeed?.() ?? 1;
        speedEl.textContent = `${speed.toFixed(1)}x`;
        row.appendChild(speedEl);

        // Stop button
        const stopBtn = document.createElement('button');
        stopBtn.className = 'sv-track-row-btn sv-track-row-stop';
        stopBtn.textContent = '\u25A0';
        stopBtn.title = `Stop track ${t.trackIndex}`;
        stopBtn.addEventListener('click', () => {
            this.spineManager.clearTrack(t.trackIndex);
            // Immediately remove the row for instant feedback
            row.remove();
            this.trackRows.delete(t.trackIndex);
            if (this.trackRows.size === 0) {
                this.emptyMsg.style.display = '';
            }
        });
        row.appendChild(stopBtn);

        this.inner.appendChild(row);
        this.trackRows.set(t.trackIndex, { row, animSelect, progressFill: fill, timeEl, loopBtn, speedEl });
    }
}
