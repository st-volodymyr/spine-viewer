export interface CurrentTrackInfo {
    name: string;
    time: number;
    duration: number;
    loop: boolean;
}

export interface TrackInfo extends CurrentTrackInfo {
    trackIndex: number;
}

/**
 * Capabilities a host (single viewer or comparison) provides to drive the
 * shared tracks bar. Optional members enable single-mode-only features
 * (scrubbing, frame-step, heatmap).
 */
export interface TrackController {
    getAnimationNames(): string[];
    getActiveTracks(): TrackInfo[];
    getSpeed(): number;
    setAnimation(trackIndex: number, name: string, loop: boolean): void;
    setTrackLoop(trackIndex: number, loop: boolean): void;
    clearTrack(trackIndex: number): void;
    getTrackInfo?(trackIndex: number): CurrentTrackInfo | null;
    seekToPaused?(trackIndex: number, time: number): void;
    stepFrame?(trackIndex: number, dir: 1 | -1): void;
    /** Called when the user scrubs/steps so the host can reflect the forced pause. */
    onPause?(): void;
    /** Normalized [0,1] heat per timeline bucket for an animation, or null. */
    getHeat?(animName: string): number[] | null;
    /** Metric/range caption shown next to the heat strip. */
    getHeatLegend?(animName: string): { text: string; title: string } | null;
    /** Event keyframes of an animation (seconds) drawn as ticks on the groove. */
    getEventMarkers?(animName: string): { time: number; name: string }[];
}

const HEAT_BUCKETS = 40;

interface TrackRowElements {
    row: HTMLElement;
    animSelect: HTMLSelectElement;
    fill: HTMLElement;
    timeEl: HTMLElement;
    loopBtn: HTMLElement;
    speedEl: HTMLElement;
    heatBars: HTMLElement[] | null;
    heatKey: HTMLElement | null;
    markerLayer: HTMLElement | null;
    markerAnim: string;
}

/**
 * Full-width per-track row UI below the viewport. One instance per host
 * (single / comparison); behavior scales with the controller's capabilities.
 */
export class TrackBar {
    inner: HTMLElement;
    private emptyMsg: HTMLElement;
    private trackRows = new Map<number, TrackRowElements>();
    private interval: ReturnType<typeof setInterval> | null = null;
    private seekingTrack: number | null = null;

    private readonly canScrub: boolean;
    private readonly canStep: boolean;
    private readonly hasHeat: boolean;

    constructor(mountPoint: HTMLElement, private controller: TrackController) {
        this.canScrub = typeof controller.seekToPaused === 'function' && typeof controller.getTrackInfo === 'function';
        this.canStep = typeof controller.stepFrame === 'function';
        this.hasHeat = typeof controller.getHeat === 'function';

        this.inner = document.createElement('div');
        this.inner.className = 'sv-tracks-bar-inner';
        mountPoint.appendChild(this.inner);

        this.emptyMsg = document.createElement('div');
        this.emptyMsg.className = 'sv-tracks-bar-empty';
        this.emptyMsg.textContent = 'No active tracks';
        this.inner.appendChild(this.emptyMsg);
    }

    setVisible(visible: boolean): void {
        this.inner.style.display = visible ? '' : 'none';
    }

    start(): void {
        if (this.interval === null) this.interval = setInterval(() => this.update(), 150);
    }

    stop(): void {
        if (this.interval !== null) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    clear(): void {
        for (const [, row] of this.trackRows) row.row.remove();
        this.trackRows.clear();
        this.emptyMsg.style.display = '';
    }

    /** Seconds, same format as the status bar and animation list. */
    private fmtTime(time: number, duration: number): string {
        return `${time.toFixed(2)} / ${duration.toFixed(2)} s`;
    }

    /** Speed is global; only worth a badge when it isn't the default 1×. */
    private applySpeed(el: HTMLElement, speed: number): void {
        el.textContent = `×${+speed.toFixed(2)}`;
        el.style.display = Math.abs(speed - 1) < 1e-3 ? 'none' : '';
    }

    private applyLoop(btn: HTMLElement, loop: boolean): void {
        btn.textContent = loop ? 'Loop' : 'Once';
        btn.classList.toggle('sv-track-row-btn--on', loop);
        btn.title = loop ? 'Looping (click: play once)' : 'Plays once (click: loop)';
    }

    private update(): void {
        const tracks = this.controller.getActiveTracks();
        const active = new Set(tracks.map(t => t.trackIndex));

        for (const [idx, rowData] of this.trackRows) {
            if (!active.has(idx)) {
                rowData.row.remove();
                this.trackRows.delete(idx);
            }
        }

        if (tracks.length === 0) {
            this.emptyMsg.style.display = '';
            return;
        }
        this.emptyMsg.style.display = 'none';

        const animNames = this.controller.getAnimationNames();
        const speed = this.controller.getSpeed();

        for (const t of tracks) {
            const pct = t.duration > 0 ? Math.min(100, (t.time / t.duration) * 100) : 0;
            const existing = this.trackRows.get(t.trackIndex);
            if (existing) {
                if (this.seekingTrack === t.trackIndex) continue; // pointer is authoritative
                existing.fill.style.width = `${pct}%`;
                existing.timeEl.textContent = this.fmtTime(t.time, t.duration);
                this.applyLoop(existing.loopBtn, t.loop);
                if (existing.animSelect.value !== t.name) existing.animSelect.value = t.name;
                this.applySpeed(existing.speedEl, speed);
                this.updateHeat(existing, t.name);
                if (existing.markerAnim !== t.name) this.renderMarkers(existing, t.trackIndex, t.name, t.duration);
            } else {
                this.createRow(t, pct, animNames, speed);
            }
        }
    }

    private updateHeat(row: TrackRowElements, animName: string): void {
        if (!row.heatBars) return;
        if (row.heatKey) {
            const legend = this.controller.getHeatLegend?.(animName) ?? null;
            row.heatKey.textContent = legend?.text ?? 'heat —';
            row.heatKey.title = legend?.title ?? 'Heatmap fills in as the animation plays (cost per timeline position).';
        }
        const heat = this.controller.getHeat?.(animName) ?? null;
        for (let i = 0; i < row.heatBars.length; i++) {
            const bar = row.heatBars[i];
            const h = heat ? heat[i] : -1;
            if (h === undefined || h < 0) {
                bar.style.background = 'transparent';
            } else {
                // green → amber → red
                const hue = (1 - h) * 120; // 120=green, 0=red
                bar.style.background = `hsl(${hue}, 70%, 45%)`;
            }
        }
    }

    private createRow(t: TrackInfo, pct: number, animNames: string[], speed: number): void {
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
            const cur = this.controller.getTrackInfo?.(t.trackIndex);
            this.controller.setAnimation(t.trackIndex, animSelect.value, cur?.loop ?? t.loop);
        });
        row.appendChild(animSelect);

        const loopBtn = document.createElement('button');
        loopBtn.className = 'sv-track-row-btn sv-track-row-loop';
        this.applyLoop(loopBtn, t.loop);
        loopBtn.addEventListener('click', () => {
            const cur = this.controller.getTrackInfo?.(t.trackIndex);
            const next = !(cur?.loop ?? t.loop);
            this.controller.setTrackLoop(t.trackIndex, next);
        });
        row.appendChild(loopBtn);

        if (this.canStep) {
            const back = document.createElement('button');
            back.className = 'sv-track-row-btn';
            back.textContent = '−1f';
            back.title = 'Step back 1 frame (keyboard: ←)';
            back.addEventListener('click', () => this.step(t.trackIndex, -1));
            row.appendChild(back);

            const fwd = document.createElement('button');
            fwd.className = 'sv-track-row-btn';
            fwd.textContent = '+1f';
            fwd.title = 'Step forward 1 frame (keyboard: →)';
            fwd.addEventListener('click', () => this.step(t.trackIndex, 1));
            row.appendChild(fwd);
        }

        // Progress groove. In single mode it doubles as a heatmap (cost per
        // timeline position) behind a translucent playhead fill, and is scrubbable.
        const progWrap = document.createElement('div');
        progWrap.className = 'sv-track-row-progress';

        let heatBars: HTMLElement[] | null = null;
        if (this.hasHeat) {
            progWrap.classList.add('sv-track-row-progress--heat');
            const heatLayer = document.createElement('div');
            heatLayer.className = 'sv-track-row-heat';
            heatBars = [];
            for (let i = 0; i < HEAT_BUCKETS; i++) {
                const b = document.createElement('div');
                b.style.cssText = 'flex:1;background:transparent';
                heatBars.push(b);
                heatLayer.appendChild(b);
            }
            progWrap.appendChild(heatLayer);
        }

        const fill = document.createElement('div');
        fill.className = 'sv-track-row-progress-fill';
        if (this.hasHeat) fill.classList.add('sv-track-row-progress-fill--overlay');
        fill.style.width = `${pct}%`;
        progWrap.appendChild(fill);

        let markerLayer: HTMLElement | null = null;
        if (this.controller.getEventMarkers) {
            markerLayer = document.createElement('div');
            markerLayer.className = 'sv-track-row-markers';
            progWrap.appendChild(markerLayer);
        }

        if (this.canScrub) {
            progWrap.style.cursor = 'pointer';
            progWrap.title = 'Click or drag to scrub';
            this.attachSeek(progWrap, fill, t.trackIndex);
        }
        row.appendChild(progWrap);

        let heatKey: HTMLElement | null = null;
        if (this.hasHeat) {
            heatKey = document.createElement('span');
            heatKey.className = 'sv-track-row-heatkey';
            row.appendChild(heatKey);
        }

        const timeEl = document.createElement('span');
        timeEl.className = 'sv-track-row-time';
        timeEl.textContent = this.fmtTime(t.time, t.duration);
        row.appendChild(timeEl);

        const speedEl = document.createElement('span');
        speedEl.className = 'sv-track-row-speed';
        speedEl.title = 'Playback speed';
        this.applySpeed(speedEl, speed);
        row.appendChild(speedEl);

        const stopBtn = document.createElement('button');
        stopBtn.className = 'sv-track-row-btn sv-track-row-stop';
        stopBtn.textContent = '■';
        stopBtn.title = `Stop track ${t.trackIndex}`;
        stopBtn.addEventListener('click', () => {
            this.controller.clearTrack(t.trackIndex);
            row.remove();
            this.trackRows.delete(t.trackIndex);
            if (this.trackRows.size === 0) this.emptyMsg.style.display = '';
        });
        row.appendChild(stopBtn);

        this.inner.appendChild(row);
        const elements: TrackRowElements = { row, animSelect, fill, timeEl, loopBtn, speedEl, heatBars, heatKey, markerLayer, markerAnim: '' };
        this.trackRows.set(t.trackIndex, elements);
        this.updateHeat(elements, t.name);
        this.renderMarkers(elements, t.trackIndex, t.name, t.duration);
    }

    /** Event ticks on the groove; clicking one seeks exactly to the event key. */
    private renderMarkers(row: TrackRowElements, trackIndex: number, animName: string, duration: number): void {
        row.markerAnim = animName;
        const layer = row.markerLayer;
        if (!layer) return;
        layer.innerHTML = '';
        if (duration <= 0) return;
        for (const m of this.controller.getEventMarkers?.(animName) ?? []) {
            const tick = document.createElement('div');
            tick.className = 'sv-track-row-marker';
            tick.style.left = `${Math.min(100, (m.time / duration) * 100)}%`;
            tick.title = `${m.name} @ ${Math.round(m.time * 1000)} ms`;
            if (this.canScrub) {
                tick.addEventListener('pointerdown', (e) => {
                    e.stopPropagation();
                    this.controller.onPause?.();
                    this.controller.seekToPaused?.(trackIndex, m.time);
                });
            }
            layer.appendChild(tick);
        }
    }

    private step(trackIndex: number, dir: 1 | -1): void {
        this.controller.stepFrame?.(trackIndex, dir);
        this.controller.onPause?.();
    }

    private attachSeek(bar: HTMLElement, fill: HTMLElement, trackIndex: number): void {
        const seekToClientX = (clientX: number): void => {
            const rect = bar.getBoundingClientRect();
            if (rect.width <= 0) return;
            const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            const info = this.controller.getTrackInfo?.(trackIndex);
            const duration = info?.duration ?? 0;
            if (duration <= 0) return;
            const time = frac * duration;
            this.controller.seekToPaused?.(trackIndex, time);
            fill.style.width = `${frac * 100}%`;
            const row = this.trackRows.get(trackIndex);
            if (row) row.timeEl.textContent = this.fmtTime(time, duration);
        };

        const onMove = (e: PointerEvent) => seekToClientX(e.clientX);
        const onUp = () => {
            this.seekingTrack = null;
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };

        bar.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            this.seekingTrack = trackIndex;
            this.controller.onPause?.();
            seekToClientX(e.clientX);
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
        });
    }
}
