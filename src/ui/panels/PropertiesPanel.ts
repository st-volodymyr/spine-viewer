import { eventBus } from '../../core/EventBus';
import type { StateManager } from '../../core/StateManager';
import type { SpineManager } from '../../core/SpineManager';

export class PropertiesPanel {
    element: HTMLElement;
    private skinSelect!: HTMLSelectElement;
    private scaleSlider!: HTMLInputElement;
    private scaleValue!: HTMLElement;
    private flipXToggle!: HTMLInputElement;
    private flipYToggle!: HTMLInputElement;

    constructor(
        private stateManager: StateManager,
        private spineManager: SpineManager,
    ) {
        this.element = document.createElement('div');
        this.build();

        eventBus.on('project:change', () => this.refresh());
    }

    private build(): void {
        // Skin
        this.element.appendChild(this.createSection('Skin', () => {
            const wrap = document.createElement('div');
            const row = this.createRow('Skin');
            this.skinSelect = document.createElement('select');
            this.skinSelect.className = 'sv-select';
            this.skinSelect.style.flex = '1';
            this.skinSelect.addEventListener('change', () => {
                this.spineManager.setSkin(this.skinSelect.value);
                this.stateManager.updateProjectA({ currentSkin: this.skinSelect.value });
            });
            row.appendChild(this.skinSelect);
            wrap.appendChild(row);
            return wrap;
        }));

        // Transform
        this.element.appendChild(this.createSection('Transform', () => {
            const wrap = document.createElement('div');

            // Scale
            const scaleRow = this.createRow('Scale');
            this.scaleSlider = document.createElement('input');
            this.scaleSlider.type = 'range';
            this.scaleSlider.className = 'sv-slider';
            this.scaleSlider.min = '0.1';
            this.scaleSlider.max = '5';
            this.scaleSlider.step = '0.1';
            this.scaleSlider.value = '1';
            this.scaleSlider.style.flex = '1';
            this.scaleSlider.addEventListener('input', () => {
                const scale = parseFloat(this.scaleSlider.value);
                this.scaleValue.textContent = scale.toFixed(1);
                this.spineManager.setScale(scale);
                this.stateManager.updateProjectA({ scale });
            });
            scaleRow.appendChild(this.scaleSlider);
            this.scaleValue = document.createElement('span');
            this.scaleValue.className = 'sv-control-value';
            this.scaleValue.textContent = '1.0';
            scaleRow.appendChild(this.scaleValue);
            wrap.appendChild(scaleRow);

            // Flip X
            const flipXRow = this.createRow('Flip X');
            this.flipXToggle = this.createToggle(false, () => this.onFlipChange());
            flipXRow.appendChild(this.flipXToggle.parentElement!);
            wrap.appendChild(flipXRow);

            // Flip Y
            const flipYRow = this.createRow('Flip Y');
            this.flipYToggle = this.createToggle(false, () => this.onFlipChange());
            flipYRow.appendChild(this.flipYToggle.parentElement!);
            wrap.appendChild(flipYRow);

            return wrap;
        }));
    }

    private onFlipChange(): void {
        const flipX = this.flipXToggle.checked;
        const flipY = this.flipYToggle.checked;
        this.spineManager.setFlip(flipX, flipY);
        this.stateManager.updateProjectA({ flipX, flipY });
    }

    refresh(): void {
        const project = this.stateManager.projectA;
        this.skinSelect.innerHTML = '';

        if (!project) return;

        project.skinNames.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            this.skinSelect.appendChild(opt);
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

    private createToggle(checked: boolean, onChange: () => void): HTMLInputElement {
        const label = document.createElement('label');
        label.className = 'sv-toggle';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = checked;
        input.addEventListener('change', onChange);
        const track = document.createElement('span');
        track.className = 'sv-toggle-track';
        label.appendChild(input);
        label.appendChild(track);
        return input;
    }
}
