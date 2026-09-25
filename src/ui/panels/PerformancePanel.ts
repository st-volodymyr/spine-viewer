import { eventBus } from '../../core/EventBus';
import type { Viewport } from '../../core/Viewport';
import type { SpineManager } from '../../core/SpineManager';
import type { ComparisonPanel } from '../panels/ComparisonPanel';
import { StressTest } from '../../services/StressTest';
import { FrameLog, formatLogTime, type FrameContext, type FrameLogEntry } from '../../services/FrameLog';
import '../../styles/perf-log.css';

const WARN_BONES = 200;
const WARN_SLOTS = 300;
const WARN_FPS = 30;
/** Selectable slow-frame thresholds (ms). */
const LOG_THRESHOLDS: Array<{ ms: number; label: string }> = [
    { ms: 20, label: '> 20 ms (50 fps)' },
    { ms: 1000 / 30, label: '> 33 ms (30 fps)' },
    { ms: 50, label: '> 50 ms (20 fps)' },
];
const LOG_OPEN_KEY = 'sv-perflog-open';

export class PerformancePanel {
    private panel: HTMLElement;
    private visible = false;
    private fpsHistory: number[] = [];
    private isCompareMode = false;
    private renderAccum = 0;        // ms accumulator to throttle DOM updates
    private bars: HTMLElement[] = []; // reused sparkline bar nodes

    private fpsEl!: HTMLElement;
    private avgEl!: HTMLElement;
    private minEl!: HTMLElement;
    private maxEl!: HTMLElement;
    private frameEl!: HTMLElement;
    private bonesEl!: HTMLElement;
    private slotsEl!: HTMLElement;
    private drawCallsEl!: HTMLElement;
    private jsHeapEl!: HTMLElement;
    private vramEl!: HTMLElement;
    private warningsEl!: HTMLElement;
    private chart!: HTMLElement;
    private skeletonSection!: HTMLElement;

    private stressTest: StressTest;

    // Slow-frame / long-task log
    private frameLog: FrameLog;
    private logSection!: HTMLElement;
    private logBadge!: HTMLElement;
    private logStats!: HTMLElement;
    private logList!: HTMLElement;
    private logEmpty!: HTMLElement;
    private logPauseBtn!: HTMLButtonElement;
    private logRowCount = 0;

    constructor(private viewport: Viewport, private spineManager: SpineManager, private comparisonPanel: ComparisonPanel | null = null) {
        this.stressTest = new StressTest(viewport, spineManager);
        this.frameLog = new FrameLog(() => this.frameContext());
        this.panel = this.buildPanel();
        document.body.appendChild(this.panel);
        viewport.ticker.add(() => this.tick());

        eventBus.on('mode:change', (mode: string) => {
            this.isCompareMode = mode === 'comparison';
            this.frameLog.suppress();
        });
        // Loading/parsing a skeleton produces giant deltas — not worth logging.
        eventBus.on('project:change', () => this.frameLog.suppress());
        eventBus.on('comparison:projects-changed', () => this.frameLog.suppress());
    }

    private buildPanel(): HTMLElement {
        const panel = document.createElement('div');
        panel.style.cssText = `
            display:none;
            position:fixed;
            top:56px;
            right:calc(var(--sv-right-panel-width) + 8px);
            max-height:calc(100vh - 160px);
            overflow-y:auto;
            z-index:5000;
            background:var(--sv-bg-surface);
            border:1px solid var(--sv-border);
            border-radius:var(--sv-radius-lg);
            box-shadow:var(--sv-shadow-lg);
            padding:12px 16px;
            min-width:300px;
            font-size:var(--sv-font-size-sm);
        `;

        const title = document.createElement('div');
        title.style.cssText = 'font-weight:600;margin-bottom:10px;display:flex;align-items:center;gap:8px';
        title.textContent = '\uD83D\uDCCA Performance';
        const closeBtn = document.createElement('button');
        closeBtn.className = 'sv-btn sv-btn-sm';
        closeBtn.style.marginLeft = 'auto';
        closeBtn.textContent = '\u00D7';
        closeBtn.addEventListener('click', () => this.hide());
        title.appendChild(closeBtn);
        panel.appendChild(title);

        // Sections
        panel.appendChild(this.buildSection('RENDERING', (grid) => {
            this.fpsEl = this.addRow(grid, 'FPS');
            this.avgEl = this.addRow(grid, 'Avg FPS');
            this.minEl = this.addRow(grid, 'Min FPS');
            this.maxEl = this.addRow(grid, 'Max FPS');
            this.frameEl = this.addRow(grid, 'Frame time');
            this.drawCallsEl = this.addRow(grid, 'Draw calls');
        }));

        this.skeletonSection = this.buildSection('SKELETON', (grid) => {
            this.bonesEl = this.addRow(grid, 'Bones');
            this.slotsEl = this.addRow(grid, 'Slots');
        });
        panel.appendChild(this.skeletonSection);

        panel.appendChild(this.buildSection('MEMORY', (grid) => {
            this.jsHeapEl = this.addRow(grid, 'JS Heap');
            this.vramEl = this.addRow(grid, 'VRAM est.');
        }));

        // FPS sparkline
        const chartLabel = document.createElement('div');
        chartLabel.style.cssText = 'margin-top:8px;font-size:10px;color:var(--sv-text-muted)';
        chartLabel.textContent = 'FPS history (last 60 frames)';
        panel.appendChild(chartLabel);

        this.chart = document.createElement('div');
        this.chart.style.cssText = 'display:flex;align-items:flex-end;gap:1px;height:30px;margin-top:4px;background:var(--sv-bg-secondary);border-radius:var(--sv-radius);padding:2px';
        // Pre-create the 60 sparkline bars once; tick() only mutates their style.
        for (let i = 0; i < 60; i++) {
            const bar = document.createElement('div');
            bar.style.cssText = 'flex:1;height:0;background:#4a9a5a;border-radius:1px 1px 0 0;min-width:0';
            this.bars.push(bar);
            this.chart.appendChild(bar);
        }
        panel.appendChild(this.chart);

        // Warnings section
        const warnLabel = document.createElement('div');
        warnLabel.style.cssText = 'margin-top:10px;font-size:10px;color:var(--sv-text-muted);font-weight:600;letter-spacing:0.4px';
        warnLabel.textContent = 'WARNINGS';
        panel.appendChild(warnLabel);

        this.warningsEl = document.createElement('div');
        this.warningsEl.style.cssText = 'margin-top:4px;font-size:11px;display:flex;flex-direction:column;gap:3px;min-height:18px';
        panel.appendChild(this.warningsEl);

        // Stress test — raise the instance count and watch FPS / draw calls above.
        const stressLabel = document.createElement('div');
        stressLabel.style.cssText = 'margin-top:12px;font-size:10px;color:var(--sv-text-muted);font-weight:600;letter-spacing:0.4px';
        stressLabel.textContent = 'STRESS TEST';
        panel.appendChild(stressLabel);

        const stressHint = document.createElement('div');
        stressHint.style.cssText = 'font-size:10px;color:var(--sv-text-muted);margin:2px 0 4px';
        stressHint.textContent = 'Clone the skeleton N times and watch the FPS ceiling.';
        panel.appendChild(stressHint);

        const stressRow = document.createElement('div');
        stressRow.style.cssText = 'display:flex;align-items:center;gap:8px';
        const stressSlider = document.createElement('input');
        stressSlider.type = 'range';
        stressSlider.className = 'sv-slider';
        stressSlider.min = '0';
        stressSlider.max = '100';
        stressSlider.step = '1';
        stressSlider.value = '0';
        stressSlider.style.flex = '1';
        const stressCount = document.createElement('span');
        stressCount.style.cssText = 'font-family:var(--sv-font-mono);font-weight:600;min-width:60px;text-align:right';
        stressCount.textContent = '0 copies';
        stressSlider.addEventListener('input', () => {
            const n = parseInt(stressSlider.value);
            this.stressTest.setCount(n);
            stressCount.textContent = `${this.stressTest.count} copies`;
        });
        stressRow.appendChild(stressSlider);
        stressRow.appendChild(stressCount);
        panel.appendChild(stressRow);

        // Keep the slider/label honest if a project reload clears the clones.
        eventBus.on('project:change', () => { stressSlider.value = '0'; stressCount.textContent = '0 copies'; });

        panel.appendChild(this.buildLogSection());

        return panel;
    }

    // ── Slow frames log ─────────────────────────────────────────────────

    private buildLogSection(): HTMLElement {
        const sec = document.createElement('div');
        sec.className = 'sv-perflog';
        this.logSection = sec;

        const header = document.createElement('div');
        header.className = 'sv-perflog-header';
        const caret = document.createElement('span');
        caret.className = 'sv-perflog-caret';
        caret.textContent = '▸';
        const title = document.createElement('span');
        title.textContent = 'SLOW FRAMES';
        this.logBadge = document.createElement('span');
        this.logBadge.className = 'sv-perflog-badge';
        this.logBadge.textContent = '0';
        header.append(caret, title, this.logBadge);
        header.addEventListener('click', () => this.setLogOpen(!sec.classList.contains('sv-perflog--open')));
        sec.appendChild(header);

        const body = document.createElement('div');
        body.className = 'sv-perflog-body';

        const controls = document.createElement('div');
        controls.className = 'sv-perflog-controls';
        const thr = document.createElement('select');
        thr.title = 'Log frames slower than';
        LOG_THRESHOLDS.forEach(o => {
            const opt = document.createElement('option');
            opt.value = String(o.ms);
            opt.textContent = o.label;
            thr.appendChild(opt);
        });
        thr.value = String(this.frameLog.threshold);
        thr.addEventListener('change', () => {
            this.frameLog.threshold = parseFloat(thr.value);
            this.recheckHotRows();
        });

        this.logPauseBtn = document.createElement('button');
        this.logPauseBtn.className = 'sv-btn sv-btn-sm';
        this.logPauseBtn.textContent = 'Pause';
        this.logPauseBtn.title = 'Pause / resume logging';
        this.logPauseBtn.addEventListener('click', () => {
            this.frameLog.enabled = !this.frameLog.enabled;
            if (this.frameLog.enabled) this.frameLog.suppress();
            this.logPauseBtn.textContent = this.frameLog.enabled ? 'Pause' : 'Resume';
            this.renderLogStats();
        });

        const clearBtn = document.createElement('button');
        clearBtn.className = 'sv-btn sv-btn-sm';
        clearBtn.textContent = 'Clear';
        clearBtn.addEventListener('click', () => {
            this.frameLog.clear();
            this.renderFrameLog();
        });

        const copyBtn = document.createElement('button');
        copyBtn.className = 'sv-btn sv-btn-sm';
        copyBtn.textContent = 'Copy';
        copyBtn.title = 'Copy log as tab-separated text (for bug reports)';
        copyBtn.addEventListener('click', () => {
            const text = this.frameLog.toText();
            const n = this.frameLog.entries().length;
            const done = (ok: boolean) => eventBus.emit('toast', {
                message: ok ? `Frame log copied (${n} entries)` : 'Clipboard not available',
                type: ok ? 'success' : 'error',
            });
            if (navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
            } else {
                done(false);
            }
        });

        controls.append(thr, this.logPauseBtn, clearBtn, copyBtn);
        body.appendChild(controls);

        this.logStats = document.createElement('div');
        this.logStats.className = 'sv-perflog-stats';
        body.appendChild(this.logStats);

        this.logList = document.createElement('div');
        this.logList.className = 'sv-perflog-list';
        this.logEmpty = document.createElement('div');
        this.logEmpty.className = 'sv-perflog-empty';
        this.logEmpty.textContent = 'No slow frames yet';
        this.logList.appendChild(this.logEmpty);
        body.appendChild(this.logList);

        sec.appendChild(body);

        let open = false;
        try { open = localStorage.getItem(LOG_OPEN_KEY) === '1'; } catch {}
        this.setLogOpen(open);
        this.renderLogStats();
        return sec;
    }

    private setLogOpen(open: boolean): void {
        this.logSection.classList.toggle('sv-perflog--open', open);
        try { localStorage.setItem(LOG_OPEN_KEY, open ? '1' : '0'); } catch {}
    }

    /** Only called for slow frames / long tasks — allocation is fine here. */
    private frameContext(): FrameContext {
        // Counter reflects the last completed render (the ticker runs before render).
        const drawCalls = this.viewport.drawCalls.last;

        if (this.isCompareMode && this.comparisonPanel) {
            const projects = this.comparisonPanel.getProjects();
            return {
                drawCalls,
                paused: projects.length > 0 && projects[0].manager.isPaused(),
                context: projects.map(p => `${p.name}: ${this.describeTracks(p.manager)}`).join(' | ') || 'no projects',
            };
        }
        return {
            drawCalls,
            paused: this.spineManager.isPaused(),
            context: this.spineManager.spine ? this.describeTracks(this.spineManager) : 'no skeleton',
        };
    }

    private describeTracks(manager: SpineManager): string {
        const tracks = manager.getAllActiveTracks();
        if (tracks.length === 0) return 'setup pose';
        return tracks
            .map(t => `T${t.trackIndex} ${t.name} @${t.time.toFixed(2)}/${t.duration.toFixed(2)}s${t.loop ? ' L' : ''}`)
            .join(', ');
    }

    private renderLogStats(): void {
        const log = this.frameLog;
        const lt = log.longTaskSupported ? String(log.longTasks) : 'not supported in this browser';
        const worst = log.worstFrameMs > 0 ? log.worstFrameMs.toFixed(1) + ' ms' : '—';
        this.logStats.textContent = `slow ${log.slowFrames} · worst ${worst} · long tasks ${lt}${log.enabled ? '' : ' · PAUSED'}`;
        const total = log.slowFrames + log.longTasks;
        this.logBadge.textContent = String(total);
        this.logBadge.classList.toggle('sv-perflog-badge--bad', total > 0);
    }

    /** Incremental: prepend new rows (newest on top), trim the tail. */
    private renderFrameLog(): void {
        const { cleared, entries } = this.frameLog.drainNew();
        if (cleared) {
            this.logList.replaceChildren(this.logEmpty);
            this.logRowCount = 0;
        }
        if (entries.length > 0) {
            if (this.logEmpty.parentNode) this.logEmpty.remove();
            const frag = document.createDocumentFragment();
            // entries are oldest-first; emit newest-first.
            for (let i = entries.length - 1; i >= 0; i--) frag.appendChild(this.buildLogRow(entries[i]));
            this.logList.insertBefore(frag, this.logList.firstChild);
            this.logRowCount += entries.length;
            while (this.logRowCount > this.frameLog.capacity && this.logList.lastChild) {
                this.logList.lastChild.remove();
                this.logRowCount--;
            }
        }
        this.renderLogStats();
    }

    private buildLogRow(e: FrameLogEntry): HTMLElement {
        const row = document.createElement('div');
        row.className = 'sv-perflog-row' + (e.kind === 'longtask' ? ' sv-perflog-row--lt' : '');
        row.dataset.ms = String(e.ms);
        if (e.kind === 'frame' && e.ms > this.frameLog.threshold * 2) row.classList.add('sv-perflog-row--hot');

        const t = document.createElement('span');
        t.className = 'sv-perflog-t';
        t.textContent = formatLogTime(e.t);
        const ms = document.createElement('span');
        ms.className = 'sv-perflog-ms';
        ms.textContent = e.ms.toFixed(1);
        const dc = document.createElement('span');
        dc.textContent = e.drawCalls !== null ? String(e.drawCalls) : '';
        const ctx = document.createElement('span');
        ctx.textContent = (e.kind === 'longtask' ? 'long task · ' : '') + (e.paused ? '⏸ ' : '') + e.context;
        row.title = `${formatLogTime(e.t)}  ${e.kind}  ${e.ms.toFixed(1)} ms`
            + (e.drawCalls !== null ? `  ${e.drawCalls} draw calls` : '')
            + (e.paused ? '  paused' : '')
            + `\n${e.context}`;
        row.append(t, ms, dc, ctx);
        return row;
    }

    /** Threshold changed — re-evaluate the 2x highlight on existing rows. */
    private recheckHotRows(): void {
        const hot = this.frameLog.threshold * 2;
        for (const el of Array.from(this.logList.children) as HTMLElement[]) {
            if (!el.dataset.ms || el.classList.contains('sv-perflog-row--lt')) continue;
            el.classList.toggle('sv-perflog-row--hot', parseFloat(el.dataset.ms) > hot);
        }
    }

    private buildSection(title: string, fill: (grid: HTMLElement) => void): HTMLElement {
        const wrap = document.createElement('div');
        wrap.style.marginBottom = '8px';
        const lbl = document.createElement('div');
        lbl.style.cssText = 'font-size:10px;color:var(--sv-text-muted);font-weight:600;letter-spacing:0.4px;margin-bottom:4px';
        lbl.textContent = title;
        wrap.appendChild(lbl);
        const grid = document.createElement('div');
        grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:3px 16px';
        fill(grid);
        wrap.appendChild(grid);
        return wrap;
    }

    private addRow(grid: HTMLElement, label: string): HTMLElement {
        const lbl = document.createElement('span');
        lbl.style.color = 'var(--sv-text-muted)';
        lbl.textContent = label;
        grid.appendChild(lbl);
        const val = document.createElement('span');
        val.style.fontFamily = 'var(--sv-font-mono)';
        val.style.fontWeight = '600';
        val.textContent = '\u2014';
        grid.appendChild(val);
        return val;
    }

    private tick(): void {
        // Raw, unclamped, speed-independent delta (deltaMS is capped at 100 ms and
        // scaled by ticker.speed). One comparison unless the frame is slow.
        this.frameLog.onFrame(this.viewport.ticker.elapsedMS);

        // Sample FPS every frame (cheap) so history is accurate…
        const fps = this.viewport.ticker.FPS;
        this.fpsHistory.push(fps);
        if (this.fpsHistory.length > 60) this.fpsHistory.shift();

        if (!this.visible) return;

        // …but only touch the DOM ~5×/sec. Rebuilding the panel every frame made
        // the profiler itself a frame-time sink.
        this.renderAccum += this.viewport.ticker.deltaMS;
        if (this.renderAccum < 200) return;
        this.renderAccum = 0;
        this.render(fps);
        this.renderFrameLog();
    }

    private render(fps: number): void {
        const avg = this.fpsHistory.reduce((s, v) => s + v, 0) / this.fpsHistory.length;
        const min = Math.min(...this.fpsHistory);
        const max = Math.max(...this.fpsHistory);
        const frameMs = this.viewport.ticker.deltaMS;

        this.fpsEl.textContent = Math.round(fps) + ' fps';
        this.fpsEl.style.color = fps < WARN_FPS ? '#c05050' : '';
        this.avgEl.textContent = avg.toFixed(1) + ' fps';
        this.minEl.textContent = Math.round(min) + ' fps';
        this.maxEl.textContent = Math.round(max) + ' fps';
        this.frameEl.textContent = frameMs.toFixed(2) + ' ms';

        const drawCalls = this.viewport.drawCalls.last;
        this.drawCallsEl.textContent = drawCalls !== null ? String(drawCalls) : '\u2014';

        // Skeleton info
        let bones = 0, slots = 0;
        if (this.isCompareMode && this.comparisonPanel) {
            const projects = this.comparisonPanel.getProjects();
            const grid = this.skeletonSection.querySelector('div:last-child') as HTMLElement;
            // Rebuild grid structure only when project count changes
            const expectedChildren = projects.length * 2;
            const firstLabel = grid.children.length > 0 ? (grid.children[0] as HTMLElement).textContent ?? '' : '';
            const expectedFirstLabel = projects[0]?.name ?? '';
            if (grid.children.length !== expectedChildren || firstLabel !== expectedFirstLabel) {
                grid.innerHTML = '';
                projects.forEach(p => {
                    const lbl = document.createElement('span');
                    lbl.style.cssText = 'color:var(--sv-text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
                    lbl.textContent = p.name;
                    grid.appendChild(lbl);
                    const val = document.createElement('span');
                    val.style.fontFamily = 'var(--sv-font-mono)';
                    val.style.fontWeight = '600';
                    grid.appendChild(val);
                });
            }
            projects.forEach((p, i) => {
                const s = p.manager.spine;
                const b = s ? s.skeleton.bones.length : 0;
                const sl = s ? s.skeleton.slots.length : 0;
                bones += b;
                slots += sl;
                const val = grid.children[i * 2 + 1] as HTMLElement;
                if (val) {
                    val.textContent = `${b}b / ${sl}sl`;
                    val.style.color = (b > WARN_BONES || sl > WARN_SLOTS) ? '#c08a30' : '';
                }
            });
            this.bonesEl.textContent = String(bones);
            this.slotsEl.textContent = String(slots);
        } else {
            const spine = this.spineManager.spine;
            if (spine) {
                bones = spine.skeleton.bones.length;
                slots = spine.skeleton.slots.length;
            }
            // Rebuild skeleton section back to standard layout if coming from compare mode
            const grid = this.skeletonSection.querySelector('div:last-child') as HTMLElement;
            if (grid.children.length !== 4 || (grid.children[0] as HTMLElement).textContent !== 'Bones') {
                grid.innerHTML = '';
                this.bonesEl = this.addRow(grid, 'Bones');
                this.slotsEl = this.addRow(grid, 'Slots');
            }
            this.bonesEl.textContent = bones > 0 ? String(bones) : '\u2014';
            this.bonesEl.style.color = bones > WARN_BONES ? '#c08a30' : '';
            this.slotsEl.textContent = slots > 0 ? String(slots) : '\u2014';
            this.slotsEl.style.color = slots > WARN_SLOTS ? '#c08a30' : '';
        }

        // JS Heap
        const mem = (performance as any).memory;
        if (mem) {
            const usedMB = (mem.usedJSHeapSize / 1048576).toFixed(1);
            const totalMB = (mem.jsHeapSizeLimit / 1048576).toFixed(0);
            this.jsHeapEl.textContent = `${usedMB} / ${totalMB} MB`;
        } else {
            this.jsHeapEl.textContent = 'N/A';
        }

        // VRAM estimate from PixiJS managed textures
        const renderer = this.viewport.app.renderer as any;
        let vramBytes = 0;
        try {
            const managedTextures: any[] = renderer.texture?.managedTextures ?? renderer._managedTextures ?? [];
            managedTextures.forEach((t: any) => {
                const w = t.realWidth ?? t.width ?? 0;
                const h = t.realHeight ?? t.height ?? 0;
                vramBytes += w * h * 4; // RGBA
            });
        } catch {}
        const vramMB = (vramBytes / 1048576).toFixed(1);
        this.vramEl.textContent = vramBytes > 0 ? `~${vramMB} MB` : '\u2014';

        // Sparkline — mutate the pre-created bars instead of rebuilding the list.
        for (let i = 0; i < this.bars.length; i++) {
            const bar = this.bars[i];
            const f = this.fpsHistory[i];
            if (f === undefined) {
                bar.style.height = '0';
                continue;
            }
            bar.style.height = `${Math.min(100, (f / 60) * 100)}%`;
            bar.style.background = f >= 55 ? '#4a9a5a' : f >= 30 ? '#c08a30' : '#c05050';
        }

        // Warnings
        this.warningsEl.innerHTML = '';
        const warnings: Array<{ msg: string; color: string }> = [];
        if (fps < WARN_FPS) warnings.push({ msg: `Low FPS (${Math.round(fps)}) \u2014 animation may stutter`, color: '#c05050' });
        if (bones > WARN_BONES) warnings.push({ msg: `High bone count (${bones}) \u2014 may impact performance`, color: '#c08a30' });
        if (slots > WARN_SLOTS) warnings.push({ msg: `High slot count (${slots}) \u2014 may impact performance`, color: '#c08a30' });

        if (warnings.length === 0) {
            const ok = document.createElement('span');
            ok.style.cssText = 'font-size:10px;color:var(--sv-text-muted)';
            ok.textContent = 'No issues detected';
            this.warningsEl.appendChild(ok);
        } else {
            warnings.forEach(w => {
                const row = document.createElement('div');
                row.style.cssText = `font-size:11px;color:${w.color};display:flex;align-items:center;gap:4px`;
                row.textContent = `\u26A0 ${w.msg}`;
                this.warningsEl.appendChild(row);
            });
        }
    }

    show(): void { this.visible = true; this.panel.style.display = 'block'; }
    hide(): void { this.visible = false; this.panel.style.display = 'none'; }
    toggle(): void { this.visible ? this.hide() : this.show(); }
}
