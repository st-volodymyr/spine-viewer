import { eventBus } from '../../core/EventBus';
import type { Viewport } from '../../core/Viewport';
import type { SpineManager } from '../../core/SpineManager';
import type { ComparisonPanel } from '../panels/ComparisonPanel';

const WARN_BONES = 200;
const WARN_SLOTS = 300;
const WARN_FPS = 30;

export class PerformancePanel {
    private panel: HTMLElement;
    private visible = false;
    private fpsHistory: number[] = [];
    private isCompareMode = false;

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

    constructor(private viewport: Viewport, private spineManager: SpineManager, private comparisonPanel: ComparisonPanel | null = null) {
        this.panel = this.buildPanel();
        document.body.appendChild(this.panel);
        viewport.ticker.add(() => this.tick());

        eventBus.on('mode:change', (mode: string) => {
            this.isCompareMode = mode === 'comparison';
        });
    }

    private buildPanel(): HTMLElement {
        const panel = document.createElement('div');
        panel.style.cssText = `
            display:none;
            position:fixed;
            top:48px;
            left:50%;
            transform:translateX(-50%);
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
        panel.appendChild(this.chart);

        // Warnings section
        const warnLabel = document.createElement('div');
        warnLabel.style.cssText = 'margin-top:10px;font-size:10px;color:var(--sv-text-muted);font-weight:600;letter-spacing:0.4px';
        warnLabel.textContent = 'WARNINGS';
        panel.appendChild(warnLabel);

        this.warningsEl = document.createElement('div');
        this.warningsEl.style.cssText = 'margin-top:4px;font-size:11px;display:flex;flex-direction:column;gap:3px;min-height:18px';
        panel.appendChild(this.warningsEl);

        return panel;
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
        const fps = this.viewport.ticker.FPS;
        this.fpsHistory.push(fps);
        if (this.fpsHistory.length > 60) this.fpsHistory.shift();

        if (!this.visible) return;

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

        // Draw calls estimate from PixiJS renderer
        const renderer = (this.viewport.app.renderer as any);
        const drawCalls = renderer._drawCallCount ?? renderer.batch?._drawCallCount ?? null;
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

        // Sparkline
        this.chart.innerHTML = '';
        const barW = Math.max(1, Math.floor((this.chart.clientWidth - 4) / 60));
        this.fpsHistory.forEach(f => {
            const bar = document.createElement('div');
            const pct = Math.min(100, (f / 60) * 100);
            const color = f >= 55 ? '#4a9a5a' : f >= 30 ? '#c08a30' : '#c05050';
            bar.style.cssText = `width:${barW}px;height:${pct}%;background:${color};border-radius:1px 1px 0 0;flex-shrink:0`;
            this.chart.appendChild(bar);
        });

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
