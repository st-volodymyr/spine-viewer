import { eventBus } from '../../core/EventBus';
import { SpineManager } from '../../core/SpineManager';
import { ComparisonEngine } from '../../services/ComparisonEngine';
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

    // Track last-applied playback state for syncing new projects
    private lastAnimation: { name: string; loop: boolean } | null = null;
    private lastSpeed = 1;
    private lastSkin: string | null = null;

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

        // Re-arrange on viewport resize
        const canvas = viewport.app.view as HTMLCanvasElement;
        const resizeObserver = new ResizeObserver(() => {
            if (this.comparisonActive && this.projects.length > 0) {
                this.arrangeProjects();
            }
        });
        resizeObserver.observe(canvas.parentElement!);
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
        if (track) this.lastAnimation = { name: track.name, loop: track.loop };
        this.lastSpeed = manager.getSpeed();
        this.lastSkin = currentSkin;
    }

    /** Add an already-loaded SpineManager as a comparison project (borrowed — do not destroy on remove) */
    addBorrowedProject(name: string, manager: SpineManager): void {
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
        this.lastAnimation = null;
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
        this.lastAnimation = null;
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
            manager.displayName = fileSet.skeleton.name;
            if (result.runtimeVersion === '4.1') {
                manager.createSpine41(result.skeletonData as any);
            } else {
                manager.createSpine(result.projectName);
            }

            const project: ComparisonProject = { name: fileSet.skeleton.name, manager };
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
                projectName: fileSet.skeleton.name,
            });

            eventBus.emit('comparison:projects-changed', this.projects);
        } catch (err: any) {
            console.error('Failed to add comparison project:', err);
        }
    }

    playAnimation(name: string, loop = true): void {
        this.lastAnimation = { name, loop };
        this.projects.forEach(p => {
            if (p.manager.getAnimationNames().includes(name)) {
                p.manager.setAnimation(0, name, loop);
            }
        });
    }

    setSkin(name: string): void {
        this.lastSkin = name;
        this.projects.forEach(p => {
            if (p.manager.getSkinNames().includes(name)) {
                p.manager.setSkin(name);
            }
        });
    }

    setAllSpeed(speed: number): void {
        this.lastSpeed = speed;
        this.projects.forEach(p => p.manager.setSpeed(speed));
    }

    setAllPaused(paused: boolean): void {
        this.projects.forEach(p => p.manager.setPaused(paused));
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

        // Animation: prefer tracked lastAnimation, fall back to reading from first project's live state
        const targetAnim = this.lastAnimation?.name
            ?? this.projects[0]?.manager.getCurrentTrackInfo(0)?.name;
        const targetLoop = this.lastAnimation?.loop ?? true;

        if (targetAnim && anims.includes(targetAnim)) {
            manager.setAnimation(0, targetAnim, targetLoop);
            // Sync playback position to first existing project
            const sourceTime = this.projects[0]?.manager.getCurrentTrackInfo(0)?.time;
            if (sourceTime !== undefined && sourceTime > 0) {
                manager.seekTo(0, sourceTime);
            }
        } else if (anims.length > 0) {
            manager.setAnimation(0, anims[0], true);
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
                manager.displayName = fileSet.skeleton.name;
                if (result.runtimeVersion === '4.1') {
                    manager.createSpine41(result.skeletonData as any);
                } else {
                    manager.createSpine(result.projectName);
                }

                const project: ComparisonProject = { name: fileSet.skeleton.name, manager };
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
                    projectName: fileSet.skeleton.name,
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

    private arrangeProjects(): void {
        // Clear old overlays
        this.clearOverlays();

        const count = this.projects.length;
        if (count === 0) return;

        const screenW = this.viewport.app.screen.width;
        const zoom = this.viewport.wrapper.scale.x || 1;
        const columnWidth = screenW / (count * zoom);

        this.projects.forEach((project, idx) => {
            if (project.manager.spine) {
                const x = (idx - (count - 1) / 2) * columnWidth;
                project.manager.spine.x = x;

                // Add label above spine
                const label = new Text(project.name, this.labelStyle);
                label.anchor.set(0.5, 1);
                label.x = x;
                label.y = -350;
                label.zIndex = 9000;
                label.scale.set(1 / zoom);
                this.viewport.wrapper.addChild(label);
                this.labels.push(label);

                // Add divider between columns (not after last)
                if (idx < count - 1) {
                    const midX = (idx - (count - 1) / 2 + 0.5) * columnWidth;
                    const divider = new Graphics();
                    divider.zIndex = 9000;
                    // Draw dashed vertical line
                    const dashLen = 20;
                    const gapLen = 10;
                    const lineHeight = 800;
                    divider.lineStyle(2, 0x666666, 0.4);
                    for (let y = -lineHeight / 2; y < lineHeight / 2; y += dashLen + gapLen) {
                        divider.moveTo(midX, y);
                        divider.lineTo(midX, Math.min(y + dashLen, lineHeight / 2));
                    }
                    this.viewport.wrapper.addChild(divider);
                    this.dividers.push(divider);
                }
            }
        });
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

        const diff = this.engine.getStructuredDiff(0, 1);
        this.renderDiffTable(diff);
    }

    private renderDiffTable(diff: StructuredDiff): void {
        const nameA = this.projects[0]?.name ?? 'Project A';
        const nameB = this.projects[1]?.name ?? 'Project B';

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
