import { eventBus } from '../../core/EventBus';
import type { StateManager } from '../../core/StateManager';
import type { SpineManager } from '../../core/SpineManager';

export class AnimationPanel {
    element: HTMLElement;
    private animSelect!: HTMLSelectElement;
    private trackSelect!: HTMLSelectElement;
    private loopToggle!: HTMLInputElement;
    private speedSlider!: HTMLInputElement;
    private speedValue!: HTMLElement;
    private queueList!: HTMLElement;
    private queue: string[] = [];

    constructor(
        private stateManager: StateManager,
        private spineManager: SpineManager,
    ) {
        this.element = document.createElement('div');
        this.build();

        eventBus.on('project:change', () => this.refresh());
        eventBus.on('project:update', () => this.refresh());
    }

    private build(): void {
        // Animation select
        this.element.appendChild(this.createSection('Animation', () => {
            const wrap = document.createElement('div');

            // Animation dropdown
            const animRow = this.createRow('Animation');
            this.animSelect = document.createElement('select');
            this.animSelect.className = 'sv-select';
            this.animSelect.style.flex = '1';
            this.animSelect.addEventListener('change', () => this.onAnimationChange());
            animRow.appendChild(this.animSelect);
            wrap.appendChild(animRow);

            // Track selector
            const trackRow = this.createRow('Track');
            this.trackSelect = document.createElement('select');
            this.trackSelect.className = 'sv-select';
            this.trackSelect.style.width = '60px';
            for (let i = 0; i < 12; i++) {
                const opt = document.createElement('option');
                opt.value = String(i);
                opt.textContent = String(i);
                this.trackSelect.appendChild(opt);
            }
            trackRow.appendChild(this.trackSelect);

            // Loop toggle
            const loopLabel = document.createElement('label');
            loopLabel.className = 'sv-toggle';
            loopLabel.style.marginLeft = '12px';
            this.loopToggle = document.createElement('input');
            this.loopToggle.type = 'checkbox';
            this.loopToggle.checked = true;
            const loopTrack = document.createElement('span');
            loopTrack.className = 'sv-toggle-track';
            loopLabel.appendChild(this.loopToggle);
            loopLabel.appendChild(loopTrack);
            trackRow.appendChild(loopLabel);
            const loopText = document.createElement('span');
            loopText.className = 'sv-control-label';
            loopText.textContent = 'Loop';
            trackRow.appendChild(loopText);
            wrap.appendChild(trackRow);

            // Play / Pause buttons
            const controlRow = document.createElement('div');
            controlRow.className = 'sv-control-row';
            controlRow.style.gap = '4px';

            const playBtn = this.createButton('Play', () => this.onAnimationChange());
            const pauseBtn = this.createButton('Pause', () => this.togglePause());
            pauseBtn.id = 'sv-pause-btn';
            const resetBtn = this.createButton('Reset Pose', () => {
                this.spineManager.resetPose();
            });
            controlRow.appendChild(playBtn);
            controlRow.appendChild(pauseBtn);
            controlRow.appendChild(resetBtn);
            wrap.appendChild(controlRow);

            return wrap;
        }));

        // Speed
        this.element.appendChild(this.createSection('Speed', () => {
            const wrap = document.createElement('div');
            const row = this.createRow('Speed');
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
                this.speedValue.textContent = speed.toFixed(1) + 'x';
                this.spineManager.setSpeed(speed);
                this.stateManager.updateProjectA({ speed });
            });
            row.appendChild(this.speedSlider);
            this.speedValue = document.createElement('span');
            this.speedValue.className = 'sv-control-value';
            this.speedValue.textContent = '1.0x';
            row.appendChild(this.speedValue);
            wrap.appendChild(row);
            return wrap;
        }));

        // Animation Queue
        this.element.appendChild(this.createSection('Animation Queue', () => {
            const wrap = document.createElement('div');

            const addRow = document.createElement('div');
            addRow.className = 'sv-control-row';
            const addBtn = this.createButton('+ Add to Queue', () => this.addToQueue());
            const playQueueBtn = this.createButton('Play Queue', () => this.playQueue());
            playQueueBtn.classList.add('sv-btn-primary');
            const clearBtn = this.createButton('Clear', () => this.clearQueue());
            addRow.appendChild(addBtn);
            addRow.appendChild(playQueueBtn);
            addRow.appendChild(clearBtn);
            wrap.appendChild(addRow);

            this.queueList = document.createElement('div');
            this.queueList.style.marginTop = '4px';
            wrap.appendChild(this.queueList);

            return wrap;
        }));
    }

    private onAnimationChange(): void {
        const name = this.animSelect.value;
        const track = parseInt(this.trackSelect.value);
        const loop = this.loopToggle.checked;
        if (!name) return;
        this.spineManager.setAnimation(track, name, loop);
        this.stateManager.updateProjectA({ currentTrack: track });
    }

    private togglePause(): void {
        const project = this.stateManager.projectA;
        if (!project) return;
        const paused = !project.paused;
        this.spineManager.setPaused(paused);
        this.stateManager.updateProjectA({ paused });
        const btn = document.getElementById('sv-pause-btn');
        if (btn) btn.textContent = paused ? 'Resume' : 'Pause';
    }

    private addToQueue(): void {
        const name = this.animSelect.value;
        if (!name) return;
        this.queue.push(name);
        this.renderQueue();
    }

    private playQueue(): void {
        if (this.queue.length === 0) return;
        const track = parseInt(this.trackSelect.value);
        const list = [...this.queue];
        this.spineManager.setAnimationsList(track, list, true);
    }

    private clearQueue(): void {
        this.queue = [];
        this.renderQueue();
    }

    private renderQueue(): void {
        this.queueList.innerHTML = '';
        this.queue.forEach((name, idx) => {
            const item = document.createElement('div');
            item.style.display = 'flex';
            item.style.alignItems = 'center';
            item.style.gap = '4px';
            item.style.padding = '2px 0';
            item.style.fontSize = 'var(--sv-font-size-sm)';

            const label = document.createElement('span');
            label.textContent = `${idx + 1}. ${name}`;
            label.style.flex = '1';
            item.appendChild(label);

            const removeBtn = document.createElement('button');
            removeBtn.className = 'sv-btn sv-btn-sm';
            removeBtn.textContent = 'x';
            removeBtn.addEventListener('click', () => {
                this.queue.splice(idx, 1);
                this.renderQueue();
            });
            item.appendChild(removeBtn);

            this.queueList.appendChild(item);
        });
    }

    refresh(): void {
        const project = this.stateManager.projectA;
        this.animSelect.innerHTML = '';

        if (!project) return;

        project.animationNames.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            this.animSelect.appendChild(opt);
        });
    }

    private createSection(title: string, buildContent: () => HTMLElement): HTMLElement {
        const section = document.createElement('div');
        section.className = 'sv-section';

        const header = document.createElement('div');
        header.className = 'sv-section-header';
        const arrow = document.createElement('span');
        arrow.className = 'sv-section-arrow';
        arrow.textContent = '\u25BC';
        header.appendChild(arrow);
        const titleEl = document.createElement('span');
        titleEl.textContent = title;
        header.appendChild(titleEl);
        section.appendChild(header);

        const body = document.createElement('div');
        body.className = 'sv-section-body';
        body.appendChild(buildContent());
        section.appendChild(body);

        header.addEventListener('click', () => {
            header.classList.toggle('collapsed');
        });

        return section;
    }

    private createRow(label: string): HTMLElement {
        const row = document.createElement('div');
        row.className = 'sv-control-row';
        const lbl = document.createElement('span');
        lbl.className = 'sv-control-label';
        lbl.textContent = label;
        row.appendChild(lbl);
        return row;
    }

    private createButton(text: string, onClick: () => void): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.className = 'sv-btn sv-btn-sm';
        btn.textContent = text;
        btn.addEventListener('click', onClick);
        return btn;
    }
}
