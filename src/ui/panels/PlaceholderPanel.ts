import { eventBus } from '../../core/EventBus';
import { Graphics, Container } from '@electricelephants/pixi-ext';
import type { SpineManager } from '../../core/SpineManager';
import type { StateManager } from '../../core/StateManager';

interface PlaceholderMarker {
    slotName: string;
    graphics: Graphics;
    visible: boolean;
}

export class PlaceholderPanel {
    element: HTMLElement;
    private listEl!: HTMLElement;
    private showAllToggle!: HTMLInputElement;
    private markers: PlaceholderMarker[] = [];

    constructor(
        private stateManager: StateManager,
        private spineManager: SpineManager,
    ) {
        this.element = document.createElement('div');
        this.build();

        eventBus.on('project:change', () => this.refresh());
    }

    private build(): void {
        // Header with toggle all
        const header = document.createElement('div');
        header.className = 'sv-control-row';
        header.style.padding = '4px 0';

        const label = document.createElement('span');
        label.className = 'sv-control-label';
        label.textContent = 'Show All Placeholders';
        header.appendChild(label);

        const toggleLabel = document.createElement('label');
        toggleLabel.className = 'sv-toggle';
        this.showAllToggle = document.createElement('input');
        this.showAllToggle.type = 'checkbox';
        this.showAllToggle.addEventListener('change', () => this.toggleAll());
        const track = document.createElement('span');
        track.className = 'sv-toggle-track';
        toggleLabel.appendChild(this.showAllToggle);
        toggleLabel.appendChild(track);
        header.appendChild(toggleLabel);

        this.element.appendChild(header);

        // Info text
        const info = document.createElement('div');
        info.style.fontSize = 'var(--sv-font-size-sm)';
        info.style.color = 'var(--sv-text-muted)';
        info.style.padding = '4px 0';
        info.textContent = 'Slots that can be used as placeholders. Toggle to show position markers.';
        this.element.appendChild(info);

        // Slot list
        this.listEl = document.createElement('div');
        this.element.appendChild(this.listEl);
    }

    refresh(): void {
        this.clearMarkers();
        this.listEl.innerHTML = '';

        const project = this.stateManager.projectA;
        if (!project) return;

        project.slotNames.forEach(slotName => {
            const row = document.createElement('div');
            row.className = 'sv-control-row';
            row.style.padding = '2px 0';

            const name = document.createElement('span');
            name.style.flex = '1';
            name.style.fontSize = 'var(--sv-font-size-sm)';
            name.textContent = slotName;
            row.appendChild(name);

            // Show marker toggle
            const toggleLabel = document.createElement('label');
            toggleLabel.className = 'sv-toggle';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.addEventListener('change', () => {
                if (input.checked) {
                    this.showMarker(slotName);
                } else {
                    this.hideMarker(slotName);
                }
            });
            const track = document.createElement('span');
            track.className = 'sv-toggle-track';
            toggleLabel.appendChild(input);
            toggleLabel.appendChild(track);
            row.appendChild(toggleLabel);

            this.listEl.appendChild(row);
        });
    }

    private showMarker(slotName: string): void {
        if (!this.spineManager.spine) return;

        const spine = this.spineManager.spine;
        const slot = spine.skeleton.findSlot(slotName);
        if (!slot || !slot.bone) return;

        const g = new Graphics();
        g.zIndex = 999;

        // Draw cross-hair marker at slot position
        const size = 12;
        g.lineStyle(2, 0xff6600, 0.9);
        g.moveTo(-size, 0);
        g.lineTo(size, 0);
        g.moveTo(0, -size);
        g.lineTo(0, size);
        g.lineStyle(1, 0xff6600, 0.5);
        g.drawCircle(0, 0, size);

        // Label
        // Position will be updated in spine's coordinate space
        try {
            const container = spine.getSlotContainer(slotName);
            container.addChild(g);
        } catch {
            // If we can't get slot container, place relative to bone
            g.position.set(slot.bone.worldX, slot.bone.worldY);
            spine.addChild(g);
        }

        this.markers.push({ slotName, graphics: g, visible: true });
    }

    private hideMarker(slotName: string): void {
        const idx = this.markers.findIndex(m => m.slotName === slotName);
        if (idx >= 0) {
            this.markers[idx].graphics.destroy();
            this.markers.splice(idx, 1);
        }
    }

    private toggleAll(): void {
        const show = this.showAllToggle.checked;
        const project = this.stateManager.projectA;
        if (!project) return;

        if (show) {
            project.slotNames.forEach(name => this.showMarker(name));
        } else {
            this.clearMarkers();
        }

        // Update individual toggles
        const toggles = this.listEl.querySelectorAll('input[type="checkbox"]');
        toggles.forEach(t => (t as HTMLInputElement).checked = show);
    }

    private clearMarkers(): void {
        this.markers.forEach(m => m.graphics.destroy());
        this.markers = [];
    }
}
