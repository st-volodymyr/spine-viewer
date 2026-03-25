import { eventBus } from '../../core/EventBus';
import { SpineManager } from '../../core/SpineManager';
import { ComparisonEngine } from '../../services/ComparisonEngine';
import { loadSpineFiles, createFileInput } from '../../services/FileLoader';
import { parseSpineFiles } from '../../services/SpineParser';
import { detectSpineVersion } from '../../services/SpineVersionDetector';
import type { Viewport } from '../../core/Viewport';
import { Container } from '@electricelephants/pixi-ext';

interface ComparisonProject {
    name: string;
    manager: SpineManager;
    container: Container;
}

export class ComparisonPanel {
    element: HTMLElement;
    private projectList!: HTMLElement;
    private diffSummary!: HTMLElement;
    private syncToggle!: HTMLInputElement;
    private animSelect!: HTMLSelectElement;
    private skinSelect!: HTMLSelectElement;

    private projects: ComparisonProject[] = [];
    private engine = new ComparisonEngine();
    private viewport: Viewport;
    private originalWrapper: Container;
    private comparisonActive = false;

    constructor(viewport: Viewport) {
        this.viewport = viewport;
        this.originalWrapper = viewport.wrapper;
        this.element = document.createElement('div');
        this.build();
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
        desc.textContent = 'Load multiple projects to compare animations side by side.';
        header.appendChild(desc);

        this.element.appendChild(header);

        // Controls row
        const controlRow = document.createElement('div');
        controlRow.className = 'sv-control-row';
        controlRow.style.padding = '8px 0';

        const addBtn = document.createElement('button');
        addBtn.className = 'sv-btn sv-btn-sm sv-btn-primary';
        addBtn.textContent = '+ Add Project';
        addBtn.addEventListener('click', () => this.addProject());
        controlRow.appendChild(addBtn);

        const addFolderBtn = document.createElement('button');
        addFolderBtn.className = 'sv-btn sv-btn-sm';
        addFolderBtn.textContent = '+ Add Folder';
        addFolderBtn.addEventListener('click', () => this.addProject(true));
        controlRow.appendChild(addFolderBtn);

        // Sync toggle
        const syncLabel = document.createElement('label');
        syncLabel.className = 'sv-toggle';
        syncLabel.style.marginLeft = '8px';
        this.syncToggle = document.createElement('input');
        this.syncToggle.type = 'checkbox';
        this.syncToggle.checked = true;
        this.syncToggle.addEventListener('change', () => {
            this.engine.syncEnabled = this.syncToggle.checked;
        });
        const syncTrack = document.createElement('span');
        syncTrack.className = 'sv-toggle-track';
        syncLabel.appendChild(this.syncToggle);
        syncLabel.appendChild(syncTrack);
        controlRow.appendChild(syncLabel);

        const syncText = document.createElement('span');
        syncText.className = 'sv-control-label';
        syncText.textContent = 'Sync';
        controlRow.appendChild(syncText);

        this.element.appendChild(controlRow);

        // Shared animation/skin controls
        const sharedControls = document.createElement('div');
        sharedControls.style.padding = '4px 0';
        sharedControls.style.borderBottom = '1px solid var(--sv-border)';

        const animRow = document.createElement('div');
        animRow.className = 'sv-control-row';
        const animLabel = document.createElement('span');
        animLabel.className = 'sv-control-label';
        animLabel.textContent = 'Animation';
        animRow.appendChild(animLabel);
        this.animSelect = document.createElement('select');
        this.animSelect.className = 'sv-select';
        this.animSelect.style.flex = '1';
        this.animSelect.addEventListener('change', () => this.playAllAnimation());
        animRow.appendChild(this.animSelect);
        sharedControls.appendChild(animRow);

        const skinRow = document.createElement('div');
        skinRow.className = 'sv-control-row';
        const skinLabel = document.createElement('span');
        skinLabel.className = 'sv-control-label';
        skinLabel.textContent = 'Skin';
        skinRow.appendChild(skinLabel);
        this.skinSelect = document.createElement('select');
        this.skinSelect.className = 'sv-select';
        this.skinSelect.style.flex = '1';
        this.skinSelect.addEventListener('change', () => this.setAllSkin());
        skinRow.appendChild(this.skinSelect);
        sharedControls.appendChild(skinRow);

        this.element.appendChild(sharedControls);

        // Project list
        this.projectList = document.createElement('div');
        this.projectList.style.padding = '4px 0';
        this.element.appendChild(this.projectList);

        // Diff summary
        const diffHeader = document.createElement('div');
        diffHeader.className = 'sv-section-header';
        diffHeader.innerHTML = '<span class="sv-section-arrow">\u25BC</span><span>Diff Summary</span>';
        diffHeader.addEventListener('click', () => diffHeader.classList.toggle('collapsed'));
        this.element.appendChild(diffHeader);

        this.diffSummary = document.createElement('pre');
        this.diffSummary.className = 'sv-section-body';
        this.diffSummary.style.fontFamily = 'var(--sv-font-mono)';
        this.diffSummary.style.fontSize = '11px';
        this.diffSummary.style.whiteSpace = 'pre-wrap';
        this.diffSummary.style.maxHeight = '300px';
        this.diffSummary.style.overflow = 'auto';
        this.element.appendChild(this.diffSummary);
    }

    private async addProject(folder = false): Promise<void> {
        const input = createFileInput(true, async (files) => {
            try {
                const fileSet = await loadSpineFiles(files);
                const versionInfo = detectSpineVersion(fileSet);
                const result = await parseSpineFiles(fileSet);

                // Create a new container for this project in the viewport
                const container = new Container();
                container.sortableChildren = true;
                this.viewport.wrapper.addChild(container);

                // Create SpineManager for this project
                const manager = new SpineManager(this.viewport);
                const spine = manager.createSpine(result.projectName);

                // Position side-by-side
                const idx = this.projects.length;
                this.arrangeProjects(idx + 1);

                const project: ComparisonProject = {
                    name: fileSet.skeleton.name,
                    manager,
                    container,
                };
                this.projects.push(project);

                // Set default animation
                const anims = manager.getAnimationNames();
                if (anims.length > 0) {
                    manager.setAnimation(0, anims[0], true);
                }
                const skins = manager.getSkinNames();
                if (skins.length > 0) {
                    manager.setSkin(skins[0]);
                }

                this.engine.setManagers(this.projects.map(p => p.manager));
                this.renderProjectList();
                this.updateSharedControls();
                this.updateDiff();

                if (!this.comparisonActive) {
                    this.comparisonActive = true;
                }
            } catch (err: any) {
                console.error('Failed to add comparison project:', err);
            }
        }, folder);
        input.click();
    }

    private arrangeProjects(count: number): void {
        // Arrange spine elements side-by-side
        const spacing = 400;
        const totalWidth = (count - 1) * spacing;
        this.projects.forEach((project, idx) => {
            if (project.manager.spine) {
                project.manager.spine.x = -totalWidth / 2 + idx * spacing;
            }
        });
    }

    private removeProject(idx: number): void {
        const project = this.projects[idx];
        project.manager.destroy();
        project.container.destroy();
        this.projects.splice(idx, 1);
        this.engine.setManagers(this.projects.map(p => p.manager));
        this.arrangeProjects(this.projects.length);
        this.renderProjectList();
        this.updateSharedControls();
        this.updateDiff();
    }

    private renderProjectList(): void {
        this.projectList.innerHTML = '';
        this.projects.forEach((project, idx) => {
            const row = document.createElement('div');
            row.className = 'sv-control-row';
            row.style.padding = '4px 0';
            row.style.borderBottom = '1px solid var(--sv-border-light)';

            const colorDot = document.createElement('span');
            const colors = ['#4a7fb5', '#c08a30', '#4a9a5a', '#c05050', '#9a4ab5'];
            colorDot.style.width = '8px';
            colorDot.style.height = '8px';
            colorDot.style.borderRadius = '50%';
            colorDot.style.background = colors[idx % colors.length];
            colorDot.style.flexShrink = '0';
            row.appendChild(colorDot);

            const label = document.createElement('span');
            label.style.flex = '1';
            label.style.fontSize = 'var(--sv-font-size-sm)';
            label.textContent = `${idx + 1}. ${project.name}`;
            row.appendChild(label);

            const infoSpan = document.createElement('span');
            infoSpan.className = 'sv-tree-badge';
            infoSpan.textContent = `${project.manager.getAnimationNames().length} anims`;
            row.appendChild(infoSpan);

            const removeBtn = document.createElement('button');
            removeBtn.className = 'sv-btn sv-btn-sm';
            removeBtn.textContent = 'x';
            removeBtn.addEventListener('click', () => this.removeProject(idx));
            row.appendChild(removeBtn);

            this.projectList.appendChild(row);
        });
    }

    private updateSharedControls(): void {
        this.animSelect.innerHTML = '';
        this.skinSelect.innerHTML = '';

        if (this.projects.length === 0) return;

        // Find shared animations (present in all projects)
        const animSets = this.projects.map(p => new Set(p.manager.getAnimationNames()));
        const sharedAnims = [...animSets[0]].filter(a => animSets.every(s => s.has(a)));

        // Also add all unique animations
        const allAnims = new Set<string>();
        this.projects.forEach(p => p.manager.getAnimationNames().forEach(a => allAnims.add(a)));

        if (sharedAnims.length > 0) {
            const group = document.createElement('optgroup');
            group.label = 'Shared';
            sharedAnims.forEach(name => {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = name;
                group.appendChild(opt);
            });
            this.animSelect.appendChild(group);
        }

        const uniqueAnims = [...allAnims].filter(a => !sharedAnims.includes(a));
        if (uniqueAnims.length > 0) {
            const group = document.createElement('optgroup');
            group.label = 'Other';
            uniqueAnims.forEach(name => {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = name;
                group.appendChild(opt);
            });
            this.animSelect.appendChild(group);
        }

        // Shared skins
        const skinSets = this.projects.map(p => new Set(p.manager.getSkinNames()));
        const allSkins = new Set<string>();
        this.projects.forEach(p => p.manager.getSkinNames().forEach(s => allSkins.add(s)));
        allSkins.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            this.skinSelect.appendChild(opt);
        });
    }

    private playAllAnimation(): void {
        const name = this.animSelect.value;
        if (!name) return;
        this.projects.forEach(p => {
            if (p.manager.getAnimationNames().includes(name)) {
                p.manager.setAnimation(0, name, true);
            }
        });
    }

    private setAllSkin(): void {
        const name = this.skinSelect.value;
        if (!name) return;
        this.projects.forEach(p => {
            if (p.manager.getSkinNames().includes(name)) {
                p.manager.setSkin(name);
            }
        });
    }

    private updateDiff(): void {
        this.diffSummary.textContent = this.engine.getFullDiffSummary();
    }
}
