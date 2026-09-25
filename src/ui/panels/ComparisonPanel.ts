import { eventBus } from '../../core/EventBus';
import { SpineManager } from '../../core/SpineManager';
import { ComparisonEngine, FRAME_30 } from '../../services/ComparisonEngine';
import '../../styles/compare-diff.css';
import { loadSpineFiles, createFileInput } from '../../services/FileLoader';
import { parseSpineFiles } from '../../services/SpineParser';
import { detectSpineVersion } from '../../services/SpineVersionDetector';
import { parseAtlasText } from '../../services/AtlasParser';
import type { Viewport } from '../../core/Viewport';
import type { StructuredDiff } from '../../types/state';
import { Graphics, Text, TextStyle } from '@electricelephants/pixi-ext';

export interface ComparisonProject {
    name: string;
    manager: SpineManager;
    borrowed?: boolean;  // true = owned by single mode, don't destroy on remove
}

const PROJECT_COLORS = ['#4a7fb5', '#c08a30', '#4a9a5a', '#c05050', '#9a4ab5'];

export class ComparisonPanel {
    element: HTMLElement;
    private projectList!: HTMLElement;
    private diffContainer!: HTMLElement;
    private emptyState!: HTMLElement;

    private projects: ComparisonProject[] = [];
    private engine = new ComparisonEngine();
    private viewport: Viewport;
    private comparisonActive = false;

    // Track last-applied playback state per track for syncing new projects
    private lastTracks: Map<number, { name: string; loop: boolean }> = new Map();
    private lastSpeed = 1;
    private lastSkin: string | null = null;

    // Which two projects the diff compares (indices into `projects`); pickable when 3+ are loaded.
    private diffA = 0;
    private diffB = 1;

    // PixiJS overlays
    private dividers: Graphics[] = [];
    private labels: Text[] = [];
    private labelStyle = new TextStyle({
        fontSize: 14,
        fill: 0x333333,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontWeight: 'bold',
    });

    constructor(viewport: Viewport) {
        this.viewport = viewport;
        this.element = document.createElement('div');
        this.build();

        // Listen for mode changes
        eventBus.on('mode:change', (mode: string) => {
            if (mode !== 'comparison') {
                this.hideOverlays();
                // Only hide non-borrowed spines; borrowed spine is managed by App
                this.projects.forEach(p => {
                    if (!p.borrowed && p.manager.spine) p.manager.spine.visible = false;
                });
                this.comparisonActive = false;
            } else {
                this.projects.forEach(p => {
                    if (p.manager.spine) p.manager.spine.visible = true;
                });
                if (this.projects.length > 0) {
                    this.arrangeProjects();
                }
                this.comparisonActive = true;
                this.updateEmptyState();
            }
        });

        // Keep project labels a constant on-screen size as the view zooms (fit, wheel, slider).
        eventBus.on('viewport:change', () => {
            const zoom = this.viewport.wrapper.scale.x || 1;
            this.labels.forEach(l => l.scale.set(1 / zoom));
        });

        // Re-arrange on viewport resize
        const canvas = viewport.app.view as HTMLCanvasElement;
        const resizeObserver = new ResizeObserver(() => {
            if (this.comparisonActive && this.projects.length > 0) {
                this.arrangeProjects(false);
            }
        });
        resizeObserver.observe(canvas.parentElement!);
    }

    /** Same-named skeletons (e.g. two versions of one export) get a "#2", "#3" suffix so labels stay distinguishable. */
    private uniqueName(base: string): string {
        const taken = new Set(this.projects.map(p => p.name));
        if (!taken.has(base)) return base;
        let i = 2;
        while (taken.has(`${base} #${i}`)) i++;
        return `${base} #${i}`;
    }

    getProjects(): ComparisonProject[] {
        return this.projects;
    }

    getEngine(): ComparisonEngine {
        return this.engine;
    }

    /** Seed tracking state from the single-mode manager so new projects sync correctly */
    initCompareStateFrom(manager: SpineManager, currentSkin: string | null): void {
        const track = manager.getCurrentTrackInfo(0);
        if (track) this.lastTracks.set(0, { name: track.name, loop: track.loop });
        this.lastSpeed = manager.getSpeed();
        this.lastSkin = currentSkin;
    }

    /** Add an already-loaded SpineManager as a comparison project (borrowed — do not destroy on remove) */
    addBorrowedProject(baseName: string, manager: SpineManager): void {
        const name = this.uniqueName(baseName);
        manager.displayName = name;
        const project: ComparisonProject = { name, manager, borrowed: true };
        this.projects.push(project);
        this.rebuildEngine();
        this.arrangeProjects();
        this.renderProjectList();
        this.updateDiff();
        this.updateEmptyState();
        this.comparisonActive = true;
        eventBus.emit('comparison:projects-changed', this.projects);
    }

    /** Remove borrowed project(s) from the compare list without destroying them */
    releaseBorrowedProjects(): void {
        this.projects = this.projects.filter(p => !p.borrowed);
        this.rebuildEngine();
        this.clearOverlays();
        this.renderProjectList();
        this.updateDiff();
        this.updateEmptyState();
        this.comparisonActive = false;
        this.lastTracks.clear();
        this.lastSpeed = 1;
        this.lastSkin = null;
        eventBus.emit('comparison:projects-changed', this.projects);
    }

    /** Destroy all non-borrowed projects and release borrowed ones — used when resetting on mode switch */
    clearAllCompareProjects(): void {
        this.projects.forEach(p => { if (!p.borrowed) p.manager.destroy(); });
        this.projects = [];
        this.rebuildEngine();
        this.clearOverlays();
        this.renderProjectList();
        this.updateDiff();
        this.updateEmptyState();
        this.comparisonActive = false;
        this.lastTracks.clear();
        this.lastSpeed = 1;
        this.lastSkin = null;
        eventBus.emit('comparison:projects-changed', this.projects);
    }

    /** Called from toolbar "Add Project" button */
    addProjectFromToolbar(): void {
        this.addProject(false);
    }

    /** Called when files are dropped/opened while in compare mode */
    async addProjectFromFiles(files: FileList): Promise<void> {
        try {
            const fileSet = await loadSpineFiles(files);
            const versionInfo = detectSpineVersion(fileSet);
            const result = await parseSpineFiles(fileSet, versionInfo.detected === '4.1' ? '4.1' : '4.2');

            const manager = new SpineManager(this.viewport);
            const name = this.uniqueName(fileSet.skeleton.name);
            manager.displayName = name;
            if (result.runtimeVersion === '4.1') {
                manager.createSpine41(result.skeletonData as any);
            } else {
                manager.createSpine(result.projectName);
            }

            const project: ComparisonProject = { name, manager };
            this.syncNewProjectToActive(manager);
            this.projects.push(project);

            this.rebuildEngine();
            this.arrangeProjects();
            this.renderProjectList();
            this.updateDiff();
            this.updateEmptyState();
            this.comparisonActive = true;

            // Emit atlas data for atlas inspector (with projectName for compare mode)
            const parsedAtlas = parseAtlasText(fileSet.atlas.data);
            eventBus.emit('atlas:loaded', {
                atlas: parsedAtlas,
                textures: fileSet.textures,
                usedRegionNames: new Set<string>(),
                projectName: name,
            });

            eventBus.emit('comparison:projects-changed', this.projects);
        } catch (err: any) {
            console.error('Failed to add comparison project:', err);
        }
    }

    playAnimation(name: string, trackIndex = 0, loop = true): void {
        const prev = this.lastTracks.get(trackIndex)?.name;
        this.lastTracks.set(trackIndex, { name, loop });
        this.projects.forEach(p => {
            if (p.manager.getAnimationNames().includes(name)) {
                p.manager.setAnimation(trackIndex, name, loop);
            }
        });
        // New animation → cells re-fit to its extent.
        if (this.comparisonActive && prev !== name) this.arrangeProjects(true);
    }

    setSkin(name: string): void {
        this.lastSkin = name;
        this.projects.forEach(p => {
            if (p.manager.getSkinNames().includes(name)) {
                p.manager.setSkin(name);
            }
        });
        if (this.comparisonActive) this.arrangeProjects(false);
    }

    setAllSpeed(speed: number): void {
        this.lastSpeed = speed;
        this.projects.forEach(p => p.manager.setSpeed(speed));
    }

    setAllPaused(paused: boolean): void {
        this.projects.forEach(p => p.manager.setPaused(paused));
    }

    /** Pause every project and put the track at the same absolute time. */
    seekAll(trackIndex: number, time: number): void {
        this.projects.forEach(p => p.manager.seekToPaused(trackIndex, time));
    }

    /** Frame-step from the first project that plays the track; others follow to the same time. */
    stepAll(trackIndex: number, dir: 1 | -1): void {
        const lead = this.projects.find(p => p.manager.getCurrentTrackInfo(trackIndex));
        if (!lead) return;
        lead.manager.stepFrame(trackIndex, dir);
        const time = lead.manager.getCurrentTrackInfo(trackIndex)?.time;
        if (time === undefined) return;
        this.projects.forEach(p => { if (p !== lead) p.manager.seekToPaused(trackIndex, time); });
    }

    setTrackLoop(trackIndex: number, loop: boolean): void {
        this.projects.forEach(p => p.manager.setTrackLoop(trackIndex, loop));
    }

    clearTrack(trackIndex: number): void {
        this.lastTracks.delete(trackIndex);
        this.projects.forEach(p => p.manager.clearTrack(trackIndex));
    }

    private build(): void {
        // Header
        const header = document.createElement('div');
        header.style.padding = '8px 0';
        header.style.borderBottom = '1px solid var(--sv-border)';

        const title = document.createElement('div');
        title.style.fontWeight = '600';
        title.style.marginBottom = '4px';
        title.textContent = 'Comparison Mode';
        header.appendChild(title);

        const desc = document.createElement('div');
        desc.style.fontSize = 'var(--sv-font-size-sm)';
        desc.style.color = 'var(--sv-text-muted)';
        desc.textContent = 'Use "+ Add Project" in the toolbar to load projects for comparison.';
        header.appendChild(desc);

        this.element.appendChild(header);

        // Empty state (shown when no projects)
        this.emptyState = document.createElement('div');
        this.emptyState.className = 'sv-compare-empty-state';
        this.emptyState.innerHTML = `
            <div style="text-align: center; padding: 24px 12px; color: var(--sv-text-muted);">
                <div style="font-size: 32px; margin-bottom: 8px;">&#x2194;</div>
                <div style="font-size: var(--sv-font-size); margin-bottom: 4px;">No projects loaded</div>
                <div style="font-size: var(--sv-font-size-sm);">Click <strong>"+ Add Project"</strong> in the toolbar to add spine files for comparison.</div>
            </div>
        `;
        this.element.appendChild(this.emptyState);

        // Project list
        this.projectList = document.createElement('div');
        this.projectList.style.padding = '4px 0';
        this.element.appendChild(this.projectList);

        // Diff container
        this.diffContainer = document.createElement('div');
        this.diffContainer.className = 'sv-diff-container';
        this.element.appendChild(this.diffContainer);
    }

    private updateEmptyState(): void {
        this.emptyState.style.display = this.projects.length === 0 ? 'block' : 'none';
    }

    /** Sync a newly created manager to the active animation/skin/speed of existing projects */
    private syncNewProjectToActive(manager: SpineManager): void {
        const anims = manager.getAnimationNames();
        const skins = manager.getSkinNames();

        // Apply all tracked per-track animations
        if (this.lastTracks.size > 0) {
            this.lastTracks.forEach(({ name, loop }, trackIndex) => {
                if (anims.includes(name)) {
                    manager.setAnimation(trackIndex, name, loop);
                    // Sync playback position on track 0 to first existing project
                    if (trackIndex === 0) {
                        const sourceTime = this.projects[0]?.manager.getCurrentTrackInfo(0)?.time;
                        if (sourceTime !== undefined && sourceTime > 0) {
                            manager.seekTo(0, sourceTime);
                        }
                    }
                }
            });
        } else {
            // Fall back to reading from first project's live state
            const targetAnim = this.projects[0]?.manager.getCurrentTrackInfo(0)?.name;
            if (targetAnim && anims.includes(targetAnim)) {
                manager.setAnimation(0, targetAnim, true);
                const sourceTime = this.projects[0]?.manager.getCurrentTrackInfo(0)?.time;
                if (sourceTime !== undefined && sourceTime > 0) {
                    manager.seekTo(0, sourceTime);
                }
            } else if (anims.length > 0) {
                manager.setAnimation(0, anims[0], true);
            }
        }

        // Speed
        manager.setSpeed(this.lastSpeed);

        // Skin: prefer tracked lastSkin
        const targetSkin = this.lastSkin ?? this.projects[0]?.manager.getSkinNames()[0];
        if (targetSkin && skins.includes(targetSkin)) {
            manager.setSkin(targetSkin);
        } else if (skins.length > 0) {
            manager.setSkin(skins[0]);
        }
    }

    private async addProject(folder: boolean): Promise<void> {
        const input = createFileInput(true, async (files) => {
            try {
                const fileSet = await loadSpineFiles(files);
                const versionInfo = detectSpineVersion(fileSet);
                const result = await parseSpineFiles(fileSet, versionInfo.detected === '4.1' ? '4.1' : '4.2');

                const manager = new SpineManager(this.viewport);
                const name = this.uniqueName(fileSet.skeleton.name);
                manager.displayName = name;
                if (result.runtimeVersion === '4.1') {
                    manager.createSpine41(result.skeletonData as any);
                } else {
                    manager.createSpine(result.projectName);
                }

                const project: ComparisonProject = { name, manager };
                this.syncNewProjectToActive(manager);
                this.projects.push(project);

                this.rebuildEngine();
                this.arrangeProjects();
                this.renderProjectList();
                this.updateDiff();
                this.updateEmptyState();
                this.comparisonActive = true;

                // Emit atlas data for atlas inspector (with projectName for compare mode)
                const parsedAtlas = parseAtlasText(fileSet.atlas.data);
                eventBus.emit('atlas:loaded', {
                    atlas: parsedAtlas,
                    textures: fileSet.textures,
                    usedRegionNames: new Set<string>(),
                    projectName: name,
                });

                eventBus.emit('comparison:projects-changed', this.projects);
            } catch (err: any) {
                console.error('Failed to add comparison project:', err);
            }
        }, folder);
        input.click();
    }

    /** Rebuild engine with current project managers - fixes sync after remove+re-add */
    private rebuildEngine(): void {
        this.engine = new ComparisonEngine();
        this.engine.setManagers(this.projects.map(p => p.manager));
    }

    /**
     * Compare layout: one grid cell per project, all at the SAME scale (so sizes
     * stay comparable). Cell = the largest project's stable bounds + padding; the
     * column count is picked to best fill the canvas aspect. With `fit`, the view
     * zooms to frame the whole grid (on add/remove, mode switch, F key).
     */
    private arrangeProjects(fit = true): void {
        this.clearOverlays();

        const placed = this.projects.filter(p => p.manager.spine);
        const count = placed.length;
        if (count === 0) return;

        // Cells are sized for what is being compared: the synced animations (all if none).
        const layoutAnims = [...this.lastTracks.values()].map(t => t.name);
        // Bounds relative to each spine's own origin (independent of where it sits now).
        const local = placed.map(p => {
            const spine = p.manager.spine!;
            const b = p.manager.getFitBounds(layoutAnims);
            return b
                ? { x: b.x - spine.x, y: b.y - spine.y, width: b.width, height: b.height }
                : { x: -100, y: -100, width: 200, height: 200 };
        });
        const pad = 1.15;
        const cellW = Math.max(...local.map(b => b.width)) * pad;
        // Extra headroom at the top of each cell for the project label.
        const labelBand = Math.max(...local.map(b => b.height)) * 0.12;
        const cellH = Math.max(...local.map(b => b.height)) * pad + labelBand;

        const { width: screenW, height: screenH } = this.viewport.app.screen;
        let cols = 1;
        let best = 0;
        for (let c = 1; c <= count; c++) {
            const rows = Math.ceil(count / c);
            const zoom = Math.min(screenW / (c * cellW), screenH / (rows * cellH));
            if (zoom > best * 1.001) { best = zoom; cols = c; }
        }
        const rows = Math.ceil(count / cols);
        const gridW = cols * cellW;
        const gridH = rows * cellH;
        const left = -gridW / 2;
        const top = -gridH / 2;
        const zoom = this.viewport.wrapper.scale.x || 1;

        placed.forEach((project, idx) => {
            const spine = project.manager.spine!;
            const b = local[idx];
            const col = idx % cols;
            const row = Math.floor(idx / cols);
            const cx = left + (col + 0.5) * cellW;
            const cy = top + row * cellH + labelBand + (cellH - labelBand) / 2;
            spine.x = cx - (b.x + b.width / 2);
            spine.y = cy - (b.y + b.height / 2);

            const label = new Text(project.name, this.labelStyle);
            label.anchor.set(0.5, 0);
            label.x = cx;
            label.y = top + row * cellH + labelBand * 0.2;
            label.zIndex = 9000;
            label.scale.set(1 / zoom);
            this.viewport.wrapper.addChild(label);
            this.labels.push(label);
        });

        // Dashed cell borders between columns and rows.
        if (count > 1) {
            const divider = new Graphics();
            divider.zIndex = 9000;
            divider.lineStyle({ width: 2 / zoom, color: 0x808080, alpha: 0.5 });
            const dash = (x1: number, y1: number, x2: number, y2: number) => {
                const len = Math.hypot(x2 - x1, y2 - y1);
                const step = 30 / zoom;
                for (let t = 0; t < len; t += step) {
                    const t2 = Math.min(len, t + step * 0.6);
                    divider.moveTo(x1 + (x2 - x1) * t / len, y1 + (y2 - y1) * t / len);
                    divider.lineTo(x1 + (x2 - x1) * t2 / len, y1 + (y2 - y1) * t2 / len);
                }
            };
            for (let c = 1; c < cols; c++) dash(left + c * cellW, top, left + c * cellW, top + gridH);
            for (let r = 1; r < rows; r++) dash(left, top + r * cellH, left + gridW, top + r * cellH);
            this.viewport.wrapper.addChild(divider);
            this.dividers.push(divider);
        }

        if (fit) {
            this.viewport.fitRect({ x: left, y: top, width: gridW, height: gridH }, 0.02);
            this.labels.forEach(l => l.scale.set(1 / (this.viewport.wrapper.scale.x || 1)));
        }
    }

    /** Re-layout and frame the compare grid (F key / fit button in compare mode). */
    fitGrid(): void {
        if (this.projects.length > 0) this.arrangeProjects(true);
    }

    private clearOverlays(): void {
        this.dividers.forEach(d => { d.parent?.removeChild(d); d.destroy(); });
        this.labels.forEach(l => { l.parent?.removeChild(l); l.destroy(); });
        this.dividers = [];
        this.labels = [];
    }

    private hideOverlays(): void {
        this.clearOverlays();
    }

    private removeProject(idx: number): void {
        const project = this.projects[idx];
        if (!project.borrowed) project.manager.destroy();
        this.projects.splice(idx, 1);
        this.rebuildEngine();
        if (this.comparisonActive) {
            this.arrangeProjects();
        }
        this.renderProjectList();
        this.updateDiff();
        this.updateEmptyState();
        eventBus.emit('comparison:projects-changed', this.projects);
    }

    private renderProjectList(): void {
        this.projectList.innerHTML = '';
        if (this.projects.length === 0) return;

        const header = document.createElement('div');
        header.className = 'sv-section-header';
        header.innerHTML = '<span class="sv-section-arrow">\u25BC</span><span>Loaded Projects</span>';
        header.addEventListener('click', () => header.classList.toggle('collapsed'));
        this.projectList.appendChild(header);

        const body = document.createElement('div');
        body.className = 'sv-section-body';

        this.projects.forEach((project, idx) => {
            const row = document.createElement('div');
            row.className = 'sv-compare-project-row';

            const colorDot = document.createElement('span');
            colorDot.className = 'sv-diff-dot';
            colorDot.style.background = PROJECT_COLORS[idx % PROJECT_COLORS.length];
            row.appendChild(colorDot);

            const label = document.createElement('span');
            label.style.flex = '1';
            label.textContent = project.name;
            row.appendChild(label);

            const infoSpan = document.createElement('span');
            infoSpan.className = 'sv-tree-badge';
            infoSpan.textContent = `${project.manager.getAnimationNames().length} anims`;
            row.appendChild(infoSpan);

            const removeBtn = document.createElement('button');
            removeBtn.className = 'sv-btn sv-btn-sm';
            removeBtn.textContent = '\u2715';
            removeBtn.title = 'Remove project';
            removeBtn.addEventListener('click', () => this.removeProject(idx));
            row.appendChild(removeBtn);

            body.appendChild(row);
        });

        this.projectList.appendChild(body);
    }

    private updateDiff(): void {
        this.diffContainer.innerHTML = '';
        if (this.projects.length < 2) {
            if (this.projects.length === 1) {
                this.diffContainer.innerHTML = '<div style="color: var(--sv-text-muted); font-size: var(--sv-font-size-sm); padding: 8px 0;">Add one more project to see diff.</div>';
            }
            return;
        }

        const n = this.projects.length;
        if (this.diffA >= n) this.diffA = 0;
        if (this.diffB >= n || this.diffB === this.diffA) this.diffB = this.diffA === 0 ? 1 : 0;
        if (n > 2) this.renderDiffPairPicker();

        const diff = this.engine.getStructuredDiff(this.diffA, this.diffB);
        this.renderDiffTable(diff);
    }

    /** "Diff [A] vs [B]" selectors — the diff is pairwise, so with 3+ projects the user picks the pair. */
    private renderDiffPairPicker(): void {
        const bar = document.createElement('div');
        bar.className = 'sv-diff-pair';
        const makeSelect = (value: number, onPick: (idx: number) => void): HTMLSelectElement => {
            const sel = document.createElement('select');
            sel.className = 'sv-select';
            this.projects.forEach((p, i) => {
                const opt = document.createElement('option');
                opt.value = String(i);
                opt.textContent = p.name;
                sel.appendChild(opt);
            });
            sel.value = String(value);
            sel.addEventListener('change', () => { onPick(Number(sel.value)); this.updateDiff(); });
            return sel;
        };
        const label = document.createElement('span');
        label.textContent = 'Diff';
        const vs = document.createElement('span');
        vs.textContent = 'vs';
        bar.append(
            label,
            makeSelect(this.diffA, i => { if (i === this.diffB) this.diffB = this.diffA; this.diffA = i; }),
            vs,
            makeSelect(this.diffB, i => { if (i === this.diffA) this.diffA = this.diffB; this.diffB = i; }),
        );
        this.diffContainer.appendChild(bar);
    }

    private renderDiffTable(diff: StructuredDiff): void {
        const nameA = this.projects[this.diffA]?.name ?? 'Project A';
        const nameB = this.projects[this.diffB]?.name ?? 'Project B';

        // Summary cards
        const summaryRow = document.createElement('div');
        summaryRow.className = 'sv-diff-summary-row';

        const cards: [string, number, number][] = [
            ['Bones', diff.summary.bonesA, diff.summary.bonesB],
            ['Slots', diff.summary.slotsA, diff.summary.slotsB],
            ['Skins', diff.summary.skinsA, diff.summary.skinsB],
            ['Events', diff.summary.eventsA, diff.summary.eventsB],
            ['Anims', diff.summary.animsShared + diff.summary.animsOnlyA, diff.summary.animsShared + diff.summary.animsOnlyB],
        ];

        cards.forEach(([label, a, b]) => {
            const card = document.createElement('div');
            card.className = 'sv-diff-card';
            if (a === b) {
                card.classList.add('sv-diff-match');
            } else {
                card.classList.add('sv-diff-mismatch');
            }
            card.innerHTML = `<div class="sv-diff-card-label">${label}</div><div class="sv-diff-card-values">${a} | ${b}</div>`;
            summaryRow.appendChild(card);
        });

        this.diffContainer.appendChild(summaryRow);

        // Animation legend
        const legend = document.createElement('div');
        legend.className = 'sv-diff-legend';
        legend.innerHTML = `
            <span><span class="sv-diff-dot sv-diff-shared"></span> Shared (${diff.summary.animsShared})</span>
            <span><span class="sv-diff-dot sv-diff-only-a"></span> Only ${nameA} (${diff.summary.animsOnlyA})</span>
            <span><span class="sv-diff-dot sv-diff-only-b"></span> Only ${nameB} (${diff.summary.animsOnlyB})</span>
        `;
        this.diffContainer.appendChild(legend);

        // Animations table
        if (diff.animations.length > 0) {
            const table = document.createElement('table');
            table.className = 'sv-diff-table';

            const thead = document.createElement('thead');
            thead.innerHTML = `<tr><th></th><th>Animation</th><th>${nameA}</th><th>${nameB}</th></tr>`;
            table.appendChild(thead);

            const tbody = document.createElement('tbody');
            diff.animations.forEach(anim => {
                const tr = document.createElement('tr');
                tr.className = `sv-diff-row-${anim.status}`;

                const dotTd = document.createElement('td');
                const dot = document.createElement('span');
                dot.className = `sv-diff-dot sv-diff-${anim.status}`;
                dotTd.appendChild(dot);
                tr.appendChild(dotTd);

                const nameTd = document.createElement('td');
                nameTd.textContent = anim.name;
                tr.appendChild(nameTd);

                const durATd = document.createElement('td');
                durATd.textContent = anim.durationA != null ? `${anim.durationA.toFixed(2)}s` : '--';
                durATd.className = 'sv-diff-duration';
                tr.appendChild(durATd);

                const durBTd = document.createElement('td');
                durBTd.textContent = anim.durationB != null ? `${anim.durationB.toFixed(2)}s` : '--';
                durBTd.className = 'sv-diff-duration';
                tr.appendChild(durBTd);

                tbody.appendChild(tr);
            });
            table.appendChild(tbody);
            this.diffContainer.appendChild(table);
        }

        // Collapsible sections for bones/slots/skins/events differences
        if (diff.bonesOnlyA.length || diff.bonesOnlyB.length) {
            this.appendDiffSection('Bones', nameA, nameB, diff.bonesOnlyA, diff.bonesOnlyB);
        }
        if (diff.slotsOnlyA.length || diff.slotsOnlyB.length) {
            this.appendDiffSection('Slots', nameA, nameB, diff.slotsOnlyA, diff.slotsOnlyB);
        }
        if (diff.skinsOnlyA.length || diff.skinsOnlyB.length) {
            this.appendDiffSection('Skins', nameA, nameB, diff.skinsOnlyA, diff.skinsOnlyB);
        }
        if (diff.eventsOnlyA.length || diff.eventsOnlyB.length || diff.eventsShared.length) {
            this.appendEventsDiffSection('Custom Events', nameA, nameB, diff.eventsOnlyA, diff.eventsOnlyB, diff.eventsShared);
        }

        // Attachment-level reskin audit.
        this.appendReskinSection(nameA, nameB);

        // Deep diff of shared content.
        this.appendDurationSection();
        this.appendEventTimingSection(nameA, nameB);
        this.appendConstraintSection(nameA, nameB);
        this.appendSlotSetupSection();
    }

    // ----- Deep diff sections -------------------------------------------------

    /**
     * Builds a collapsible deep-diff section (header with count badge + one-line
     * summary) and returns its body. Collapsed by default when there is nothing to show.
     */
    private createDeepSection(title: string, issues: number, severity: 'ok' | 'warn' | 'err', badgeText: string, summary: string): HTMLElement {
        const section = document.createElement('div');
        section.className = 'sv-diff-section sv-cdiff';

        const header = document.createElement('div');
        header.className = 'sv-section-header';
        if (issues === 0) header.classList.add('collapsed');
        const arrow = document.createElement('span');
        arrow.className = 'sv-section-arrow';
        arrow.textContent = '▼';
        const label = document.createElement('span');
        label.textContent = title;
        const badge = document.createElement('span');
        badge.className = `sv-cdiff-badge sv-cdiff-badge--${severity}`;
        badge.textContent = badgeText;
        header.append(arrow, label, badge);
        header.addEventListener('click', () => header.classList.toggle('collapsed'));
        section.appendChild(header);

        const body = document.createElement('div');
        body.className = 'sv-section-body';
        const sum = document.createElement('div');
        sum.className = 'sv-cdiff-summary';
        sum.textContent = summary;
        body.appendChild(sum);

        section.appendChild(body);
        this.diffContainer.appendChild(section);
        return body;
    }

    private cdiffBadge(issues: number, hardIssues: number): { severity: 'ok' | 'warn' | 'err'; text: string } {
        if (issues === 0) return { severity: 'ok', text: 'no differences' };
        return { severity: hardIssues > 0 ? 'err' : 'warn', text: `${issues} diff${issues !== 1 ? 's' : ''}` };
    }

    private cdiffEmpty(body: HTMLElement, text: string): void {
        const el = document.createElement('div');
        el.className = 'sv-cdiff-empty';
        el.textContent = text;
        body.appendChild(el);
    }

    /** One diff row: severity dot, main text, optional detail lines. */
    private cdiffRow(parent: HTMLElement, sev: 'err' | 'warn' | 'info', main: string, details: string[] = [], mainTitle?: string): void {
        const r = document.createElement('div');
        r.className = 'sv-cdiff-row';
        const dot = document.createElement('span');
        dot.className = `sv-cdiff-dot sv-cdiff-dot--${sev}`;
        r.appendChild(dot);
        const wrap = document.createElement('div');
        wrap.className = 'sv-cdiff-text';
        const m = document.createElement('div');
        m.className = 'sv-cdiff-main';
        m.textContent = main;
        if (mainTitle) m.title = mainTitle;
        wrap.appendChild(m);
        details.forEach(d => {
            const det = document.createElement('div');
            det.className = 'sv-cdiff-detail';
            det.textContent = d;
            det.title = d;
            wrap.appendChild(det);
        });
        r.appendChild(wrap);
        parent.appendChild(r);
    }

    private appendDurationSection(): void {
        const d = this.engine.getDurationDiff(this.diffA, this.diffB);
        const minor = d.changed.length - d.flagged;
        const badgeText = d.flagged ? `${d.flagged} > 1 frame` : minor ? `${minor} sub-frame` : 'no differences';
        const body = this.createDeepSection(
            'Animation Durations', d.changed.length, d.flagged ? 'warn' : 'ok', badgeText,
            `${d.shared} shared · ${d.flagged} differ by > 1 frame @30fps (${Math.round(FRAME_30 * 1000)}ms) · ${minor} sub-frame`,
        );
        if (d.changed.length === 0) {
            this.cdiffEmpty(body, 'All shared animations have identical durations.');
            return;
        }

        const table = document.createElement('table');
        table.className = 'sv-cdiff-table';
        table.innerHTML = '<thead><tr><th>Animation</th><th>A ms</th><th>B ms</th><th>Δ</th></tr></thead>';
        const tbody = document.createElement('tbody');
        d.changed.forEach(c => {
            const tr = document.createElement('tr');
            if (c.flagged) tr.className = 'sv-cdiff-flagged';
            const cells = [
                c.name,
                String(Math.round(c.a * 1000)),
                String(Math.round(c.b * 1000)),
                `${c.delta >= 0 ? '+' : ''}${Math.round(c.delta * 1000)}`,
            ];
            cells.forEach((v, i) => {
                const td = document.createElement('td');
                td.textContent = v;
                if (i === 0) { td.className = 'sv-cdiff-name'; td.title = v; } else td.className = 'sv-cdiff-num';
                tr.appendChild(td);
            });
            tr.title = `${(c.delta * 30).toFixed(2)} frames @30fps`;
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        body.appendChild(table);
    }

    private appendEventTimingSection(nameA: string, nameB: string): void {
        const d = this.engine.getEventTimingDiff(this.diffA, this.diffB);
        const missing = d.anims.reduce((n, a) => n + a.changes.filter(c => c.kind !== 'changed').length, 0);
        const { severity, text } = this.cdiffBadge(d.issues, missing);
        const body = this.createDeepSection(
            'Event Timing', d.issues, severity, text,
            `${d.animsCompared} shared anim(s) with events · ${d.keysCompared} key(s) matched · ${missing} missing · ${d.issues - missing} changed`,
        );
        if (d.issues === 0) {
            this.cdiffEmpty(body, d.animsCompared
                ? 'Every event key matches by name, order, time and values.'
                : 'No event keys in shared animations.');
            return;
        }

        d.anims.forEach(a => {
            const group = document.createElement('div');
            group.className = 'sv-cdiff-group';
            const head = document.createElement('div');
            head.className = 'sv-cdiff-group-title';
            head.textContent = `${a.anim}`;
            head.title = a.anim;
            const cnt = document.createElement('span');
            cnt.className = 'sv-cdiff-muted';
            cnt.textContent = ` ${a.keysA} | ${a.keysB} keys`;
            head.appendChild(cnt);
            group.appendChild(head);

            a.changes.forEach(c => {
                const label = `${c.name} #${c.index + 1}`;
                if (c.kind === 'only-a') {
                    this.cdiffRow(group, 'err', `${label} @ ${c.a!.time.toFixed(3)}s`, [`missing in ${nameB}`]);
                } else if (c.kind === 'only-b') {
                    this.cdiffRow(group, 'err', `${label} @ ${c.b!.time.toFixed(3)}s`, [`missing in ${nameA}`]);
                } else {
                    this.cdiffRow(group, 'warn', label, c.changes);
                }
            });
            body.appendChild(group);
        });
    }

    private appendConstraintSection(nameA: string, nameB: string): void {
        const d = this.engine.getConstraintDiff(this.diffA, this.diffB);
        const missing = d.onlyA.length + d.onlyB.length;
        const issues = missing + d.changed.length;
        const { severity, text } = this.cdiffBadge(issues, missing);
        const total = d.matched + d.changed.length;
        const body = this.createDeepSection(
            'Constraints', issues, severity, text,
            `${total} shared (${d.matched} identical · ${d.changed.length} changed) · ${d.onlyA.length} only in ${nameA} · ${d.onlyB.length} only in ${nameB}`,
        );
        if (issues === 0) {
            this.cdiffEmpty(body, total
                ? 'IK / transform / path / physics constraints match (targets, bones, setup params).'
                : 'Neither skeleton has constraints.');
            return;
        }
        const kindLabel = (k: string) => (k === 'ik' ? 'IK' : k);
        d.changed.forEach(c => this.cdiffRow(body, 'warn', `[${kindLabel(c.kind)}] ${c.name}`, c.changes));
        d.onlyA.forEach(c => this.cdiffRow(body, 'err', `[${kindLabel(c.kind)}] ${c.name}`, [`missing in ${nameB}`]));
        d.onlyB.forEach(c => this.cdiffRow(body, 'err', `[${kindLabel(c.kind)}] ${c.name}`, [`missing in ${nameA}`]));
    }

    private appendSlotSetupSection(): void {
        const d = this.engine.getSlotSetupDiff(this.diffA, this.diffB);
        const issues = d.changed.length;
        const { severity, text } = this.cdiffBadge(issues, 0);
        const body = this.createDeepSection(
            'Slot Setup', issues, severity, text,
            `${d.shared} shared slot(s) · ${issues} with changed setup attachment / color / blend / bone`,
        );
        if (issues === 0) {
            this.cdiffEmpty(body, 'Setup attachment, color, dark color, blend mode and parent bone match for every shared slot.');
            return;
        }
        d.changed.forEach(c => this.cdiffRow(body, 'warn', c.slot, c.changes));
    }

    private appendReskinSection(nameA: string, nameB: string): void {
        const reskin = this.engine.getReskinDiff(this.diffA, this.diffB);
        const issues = reskin.onlyA.length + reskin.onlyB.length + reskin.mismatches.length;

        const section = document.createElement('div');
        section.className = 'sv-diff-section';

        const header = document.createElement('div');
        header.className = 'sv-section-header';
        const badgeColor = issues === 0 ? '#4a9a5a' : '#c08a30';
        header.innerHTML = `<span class="sv-section-arrow">▼</span><span>Reskin Overview</span>` +
            `<span class="sv-tree-badge" style="margin-left:6px;background:${badgeColor}22;color:${badgeColor}">${issues ? `${issues} issue${issues !== 1 ? 's' : ''}` : 'all match'}</span>`;
        header.addEventListener('click', () => header.classList.toggle('collapsed'));
        section.appendChild(header);

        const body = document.createElement('div');
        body.className = 'sv-section-body';

        const summary = document.createElement('div');
        summary.style.cssText = 'font-size:var(--sv-font-size-sm);color:var(--sv-text-muted);margin-bottom:6px';
        summary.textContent = `${reskin.matched} matching attachment(s) · ${reskin.mismatches.length} changed · ${reskin.onlyA.length} only in ${nameA} · ${reskin.onlyB.length} only in ${nameB}`;
        body.appendChild(summary);

        const row = (icon: string, color: string, text: string, detail?: string) => {
            const r = document.createElement('div');
            r.style.cssText = 'display:flex;align-items:flex-start;gap:6px;padding:2px 0;font-size:var(--sv-font-size-sm)';
            const dot = document.createElement('span');
            dot.style.cssText = `flex-shrink:0;width:8px;height:8px;border-radius:2px;margin-top:4px;background:${color}`;
            r.appendChild(dot);
            const wrap = document.createElement('div');
            wrap.style.flex = '1';
            wrap.style.minWidth = '0';
            const main = document.createElement('div');
            main.textContent = `${icon} ${text}`;
            wrap.appendChild(main);
            if (detail) {
                const det = document.createElement('div');
                det.style.cssText = 'font-size:10px;color:var(--sv-text-muted)';
                det.textContent = detail;
                wrap.appendChild(det);
            }
            r.appendChild(wrap);
            body.appendChild(r);
        };

        reskin.mismatches.forEach(m => {
            const parts: string[] = [];
            if (m.regionDiffers) parts.push(`region: "${m.a.region}" → "${m.b.region}"`);
            if (m.typeDiffers) parts.push(`type: ${m.a.type} → ${m.b.type}`);
            row('⚠', '#c08a30', m.key, parts.join(' · '));
        });
        reskin.onlyA.forEach(k => row('✕', '#c05050', `${k}`, `Missing in ${nameB}`));
        reskin.onlyB.forEach(k => row('✕', '#c05050', `${k}`, `Missing in ${nameA}`));

        if (issues === 0) {
            const ok = document.createElement('div');
            ok.style.cssText = 'font-size:var(--sv-font-size-sm);color:var(--sv-text-muted)';
            ok.textContent = 'Every attachment matches by slot, name, region and type.';
            body.appendChild(ok);
        }

        section.appendChild(body);
        this.diffContainer.appendChild(section);
    }

    private appendEventsDiffSection(title: string, nameA: string, nameB: string, onlyA: string[], onlyB: string[], shared: string[]): void {
        const section = document.createElement('div');
        section.className = 'sv-diff-section';

        const header = document.createElement('div');
        header.className = 'sv-section-header';
        header.innerHTML = `<span class="sv-section-arrow">\u25BC</span><span>${title}</span>`;
        header.addEventListener('click', () => header.classList.toggle('collapsed'));
        section.appendChild(header);

        const body = document.createElement('div');
        body.className = 'sv-section-body';

        if (shared.length > 0) {
            const group = document.createElement('div');
            group.style.marginBottom = '4px';
            group.innerHTML = `<div style="font-size: var(--sv-font-size-sm); color: var(--sv-text-muted); margin-bottom: 2px;">Shared (${shared.length}):</div>`;
            shared.forEach(name => {
                const item = document.createElement('div');
                item.style.cssText = 'font-size: var(--sv-font-size-sm); padding-left: 12px; display: flex; align-items: center; gap: 4px';
                item.innerHTML = `<span class="sv-diff-dot sv-diff-shared"></span>${name}`;
                group.appendChild(item);
            });
            body.appendChild(group);
        }
        if (onlyA.length > 0) {
            const group = document.createElement('div');
            group.style.marginBottom = '4px';
            group.innerHTML = `<div style="font-size: var(--sv-font-size-sm); color: var(--sv-error); margin-bottom: 2px;">Only in ${nameA}:</div>`;
            onlyA.forEach(name => {
                const item = document.createElement('div');
                item.style.cssText = 'font-size: var(--sv-font-size-sm); padding-left: 12px; display: flex; align-items: center; gap: 4px';
                item.innerHTML = `<span class="sv-diff-dot sv-diff-only-a"></span>${name}`;
                group.appendChild(item);
            });
            body.appendChild(group);
        }
        if (onlyB.length > 0) {
            const group = document.createElement('div');
            group.innerHTML = `<div style="font-size: var(--sv-font-size-sm); color: var(--sv-accent); margin-bottom: 2px;">Only in ${nameB}:</div>`;
            onlyB.forEach(name => {
                const item = document.createElement('div');
                item.style.cssText = 'font-size: var(--sv-font-size-sm); padding-left: 12px; display: flex; align-items: center; gap: 4px';
                item.innerHTML = `<span class="sv-diff-dot sv-diff-only-b"></span>${name}`;
                group.appendChild(item);
            });
            body.appendChild(group);
        }

        section.appendChild(body);
        this.diffContainer.appendChild(section);
    }

    private appendDiffSection(title: string, nameA: string, nameB: string, onlyA: string[], onlyB: string[]): void {
        const section = document.createElement('div');
        section.className = 'sv-diff-section';

        const header = document.createElement('div');
        header.className = 'sv-section-header';
        header.innerHTML = `<span class="sv-section-arrow">\u25BC</span><span>${title} Differences</span>`;
        header.addEventListener('click', () => header.classList.toggle('collapsed'));
        section.appendChild(header);

        const body = document.createElement('div');
        body.className = 'sv-section-body';

        if (onlyA.length > 0) {
            const group = document.createElement('div');
            group.style.marginBottom = '4px';
            group.innerHTML = `<div style="font-size: var(--sv-font-size-sm); color: var(--sv-error); margin-bottom: 2px;">Only in ${nameA}:</div>`;
            onlyA.forEach(name => {
                const item = document.createElement('div');
                item.style.fontSize = 'var(--sv-font-size-sm)';
                item.style.paddingLeft = '12px';
                item.textContent = name;
                group.appendChild(item);
            });
            body.appendChild(group);
        }
        if (onlyB.length > 0) {
            const group = document.createElement('div');
            group.innerHTML = `<div style="font-size: var(--sv-font-size-sm); color: var(--sv-accent); margin-bottom: 2px;">Only in ${nameB}:</div>`;
            onlyB.forEach(name => {
                const item = document.createElement('div');
                item.style.fontSize = 'var(--sv-font-size-sm)';
                item.style.paddingLeft = '12px';
                item.textContent = name;
                group.appendChild(item);
            });
            body.appendChild(group);
        }

        section.appendChild(body);
        this.diffContainer.appendChild(section);
    }
}
