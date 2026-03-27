import { eventBus } from '../../core/EventBus';
import type { ComparisonPanel, ComparisonProject } from './ComparisonPanel';

export class ComparisonControlPanel {
    element: HTMLElement;

    private comparisonPanel: ComparisonPanel;
    private animListEl!: HTMLElement;
    private skinListEl!: HTMLElement;
    private pauseBtn!: HTMLButtonElement;
    private speedSlider!: HTMLInputElement;
    private speedValue!: HTMLElement;
    private isPaused = false;

    constructor(comparisonPanel: ComparisonPanel) {
        this.comparisonPanel = comparisonPanel;
        this.element = document.createElement('div');
        this.element.style.padding = '4px';
        this.build();

        eventBus.on('comparison:projects-changed', () => this.refresh());
    }

    private build(): void {
        // Shared Animations section
        this.element.appendChild(this.buildSection('SHARED ANIMATIONS', (body) => {
            this.animListEl = document.createElement('div');
            this.animListEl.className = 'sv-compare-anim-list';
            body.appendChild(this.animListEl);
        }));

        // Playback section
        this.element.appendChild(this.buildSection('PLAYBACK', (body) => {
            // Pause/Resume
            const pauseRow = document.createElement('div');
            pauseRow.className = 'sv-control-row';
            this.pauseBtn = document.createElement('button');
            this.pauseBtn.className = 'sv-btn sv-btn-sm';
            this.pauseBtn.textContent = 'Pause';
            this.pauseBtn.style.flex = '1';
            this.pauseBtn.addEventListener('click', () => {
                this.isPaused = !this.isPaused;
                this.pauseBtn.textContent = this.isPaused ? 'Resume' : 'Pause';
                this.comparisonPanel.setAllPaused(this.isPaused);
            });
            pauseRow.appendChild(this.pauseBtn);
            body.appendChild(pauseRow);

            // Speed slider
            const speedRow = document.createElement('div');
            speedRow.className = 'sv-control-row';
            speedRow.style.marginTop = '4px';

            const speedLabel = document.createElement('span');
            speedLabel.className = 'sv-control-label';
            speedLabel.textContent = 'Speed';
            speedRow.appendChild(speedLabel);

            this.speedSlider = document.createElement('input');
            this.speedSlider.type = 'range';
            this.speedSlider.className = 'sv-slider';
            this.speedSlider.min = '0.1';
            this.speedSlider.max = '3';
            this.speedSlider.step = '0.1';
            this.speedSlider.value = '1';
            this.speedSlider.style.flex = '1';
            this.speedSlider.addEventListener('input', () => {
                const speed = parseFloat(this.speedSlider.value);
                this.speedValue.textContent = `${speed.toFixed(1)}x`;
                this.comparisonPanel.setAllSpeed(speed);
            });
            speedRow.appendChild(this.speedSlider);

            this.speedValue = document.createElement('span');
            this.speedValue.className = 'sv-control-value';
            this.speedValue.textContent = '1.0x';
            speedRow.appendChild(this.speedValue);

            body.appendChild(speedRow);
        }));

        // Skins section
        this.element.appendChild(this.buildSection('SKINS', (body) => {
            this.skinListEl = document.createElement('div');
            this.skinListEl.className = 'sv-compare-skin-list';
            body.appendChild(this.skinListEl);
        }));
    }

    private buildSection(title: string, buildContent: (body: HTMLElement) => void): HTMLElement {
        const section = document.createElement('div');
        section.className = 'sv-section';

        const header = document.createElement('div');
        header.className = 'sv-section-header';
        header.innerHTML = `<span class="sv-section-arrow">\u25BC</span><span>${title}</span>`;
        header.addEventListener('click', () => {
            header.classList.toggle('collapsed');
        });
        section.appendChild(header);

        const body = document.createElement('div');
        body.className = 'sv-section-body';
        buildContent(body);
        section.appendChild(body);

        return section;
    }

    refresh(): void {
        const projects = this.comparisonPanel.getProjects();
        this.refreshAnimations(projects);
        this.refreshSkins(projects);
    }

    private refreshAnimations(projects: ComparisonProject[]): void {
        this.animListEl.innerHTML = '';
        if (projects.length === 0) {
            this.animListEl.innerHTML = '<div style="color: var(--sv-text-muted); font-size: var(--sv-font-size-sm);">No projects loaded</div>';
            return;
        }

        const animSets = projects.map(p => new Set(p.manager.getAnimationNames()));
        const allAnims = new Set<string>();
        projects.forEach(p => p.manager.getAnimationNames().forEach(a => allAnims.add(a)));

        const shared = [...allAnims].filter(a => animSets.every(s => s.has(a)));
        const unique = new Map<string, number[]>(); // anim -> project indices that have it

        [...allAnims].filter(a => !shared.includes(a)).forEach(a => {
            const owners: number[] = [];
            animSets.forEach((s, idx) => { if (s.has(a)) owners.push(idx); });
            unique.set(a, owners);
        });

        // Shared animations
        if (shared.length > 0) {
            const groupLabel = document.createElement('div');
            groupLabel.className = 'sv-compare-group-label';
            groupLabel.innerHTML = `<span class="sv-diff-dot sv-diff-shared"></span> Shared (${shared.length})`;
            this.animListEl.appendChild(groupLabel);

            shared.forEach(name => {
                const row = this.createAnimRow(name, projects, 'shared');
                this.animListEl.appendChild(row);
            });
        }

        // Unique animations grouped by project
        if (unique.size > 0) {
            projects.forEach((project, pIdx) => {
                const projectAnims = [...unique.entries()].filter(([, owners]) =>
                    owners.includes(pIdx) && owners.length === 1
                ).map(([name]) => name);

                if (projectAnims.length === 0) return;

                const groupLabel = document.createElement('div');
                groupLabel.className = 'sv-compare-group-label';
                const dotClass = pIdx === 0 ? 'sv-diff-only-a' : 'sv-diff-only-b';
                groupLabel.innerHTML = `<span class="sv-diff-dot ${dotClass}"></span> Only in ${project.name} (${projectAnims.length})`;
                this.animListEl.appendChild(groupLabel);

                projectAnims.forEach(name => {
                    const row = this.createAnimRow(name, projects, pIdx === 0 ? 'only-a' : 'only-b');
                    this.animListEl.appendChild(row);
                });
            });
        }
    }

    private createAnimRow(name: string, projects: ComparisonProject[], status: string): HTMLElement {
        const row = document.createElement('div');
        row.className = 'sv-compare-anim-row';
        row.addEventListener('click', () => {
            this.comparisonPanel.playAnimation(name);
            // Highlight active
            this.animListEl.querySelectorAll('.sv-compare-anim-row').forEach(r =>
                r.classList.remove('active')
            );
            row.classList.add('active');
        });

        const nameSpan = document.createElement('span');
        nameSpan.className = 'sv-compare-anim-name';
        nameSpan.textContent = name;
        row.appendChild(nameSpan);

        // Duration badges
        const durSpan = document.createElement('span');
        durSpan.className = 'sv-compare-anim-durations';
        const durations = projects.map(p => {
            const d = p.manager.getAnimationDuration(name);
            return d != null ? `${d.toFixed(2)}s` : '--';
        });
        durSpan.textContent = `[${durations.join(' | ')}]`;
        row.appendChild(durSpan);

        return row;
    }

    private refreshSkins(projects: ComparisonProject[]): void {
        this.skinListEl.innerHTML = '';
        if (projects.length === 0) return;

        const skinSets = projects.map(p => new Set(p.manager.getSkinNames()));
        const allSkins = new Set<string>();
        projects.forEach(p => p.manager.getSkinNames().forEach(s => allSkins.add(s)));

        const shared = [...allSkins].filter(s => skinSets.every(set => set.has(s)));
        const unique = [...allSkins].filter(s => !shared.includes(s));

        [...shared, ...unique].forEach(name => {
            const isShared = shared.includes(name);
            const row = document.createElement('div');
            row.className = 'sv-compare-skin-row';
            row.addEventListener('click', () => {
                this.comparisonPanel.setSkin(name);
                this.skinListEl.querySelectorAll('.sv-compare-skin-row').forEach(r =>
                    r.classList.remove('active')
                );
                row.classList.add('active');
            });

            const dot = document.createElement('span');
            dot.className = `sv-diff-dot ${isShared ? 'sv-diff-shared' : 'sv-diff-only-a'}`;
            row.appendChild(dot);

            const nameSpan = document.createElement('span');
            nameSpan.textContent = name;
            row.appendChild(nameSpan);

            this.skinListEl.appendChild(row);
        });
    }
}
