import { eventBus } from '../../core/EventBus';
import { TreeView } from '../TreeView';
import { introspectSkeleton } from '../../services/SkeletonIntrospector';
import type { SpineManager } from '../../core/SpineManager';
import type { TreeNode } from '../../types/ui';
import { Graphics } from '@electricelephants/pixi-ext';

export class SkeletonInspectorPanel {
    element: HTMLElement;
    private tabs: Map<string, HTMLElement> = new Map();
    private tabContents: Map<string, HTMLElement> = new Map();
    private tabBar: HTMLElement;
    private contentArea: HTMLElement;
    private detailPanel: HTMLElement;
    private highlightGraphics: Graphics | null = null;

    constructor(private spineManager: SpineManager) {
        this.element = document.createElement('div');
        this.element.style.display = 'flex';
        this.element.style.flexDirection = 'column';
        this.element.style.height = '100%';

        // Internal tab bar
        this.tabBar = document.createElement('div');
        this.tabBar.className = 'sv-tabs';
        this.tabBar.style.fontSize = 'var(--sv-font-size-sm)';
        this.element.appendChild(this.tabBar);

        // Content area
        this.contentArea = document.createElement('div');
        this.contentArea.style.flex = '1';
        this.contentArea.style.overflow = 'auto';
        this.contentArea.style.padding = '4px';
        this.element.appendChild(this.contentArea);

        // Detail panel (bottom)
        this.detailPanel = document.createElement('div');
        this.detailPanel.className = 'sv-detail-panel';
        this.detailPanel.style.borderTop = '1px solid var(--sv-border)';
        this.detailPanel.style.maxHeight = '150px';
        this.detailPanel.style.overflow = 'auto';
        this.element.appendChild(this.detailPanel);

        this.buildTabs();

        eventBus.on('project:change', () => this.refresh());
    }

    private buildTabs(): void {
        const categories = ['Info', 'Bones', 'Slots', 'Skins', 'Events', 'Animations', 'Constraints'];
        categories.forEach(cat => {
            const tab = document.createElement('div');
            tab.className = 'sv-tab';
            tab.textContent = cat;
            tab.style.padding = '4px 8px';
            tab.addEventListener('click', () => this.activateCategory(cat));
            this.tabBar.appendChild(tab);
            this.tabs.set(cat, tab);

            const content = document.createElement('div');
            content.style.display = 'none';
            this.tabContents.set(cat, content);
            this.contentArea.appendChild(content);
        });

        this.activateCategory('Info');
    }

    private activateCategory(cat: string): void {
        this.tabs.forEach((tab, key) => {
            tab.classList.toggle('active', key === cat);
        });
        this.tabContents.forEach((content, key) => {
            content.style.display = key === cat ? 'block' : 'none';
        });
    }

    refresh(): void {
        const spineData = this.spineManager.spineData;
        if (!spineData) return;

        const introspection = introspectSkeleton(spineData as any);
        this.clearHighlight();

        // Info
        const infoContent = this.tabContents.get('Info')!;
        infoContent.innerHTML = '';
        for (const [key, value] of Object.entries(introspection.info)) {
            const row = document.createElement('div');
            row.className = 'sv-detail-row';
            const keyEl = document.createElement('span');
            keyEl.className = 'sv-detail-key';
            keyEl.textContent = key;
            const valueEl = document.createElement('span');
            valueEl.className = 'sv-detail-value';
            valueEl.textContent = value;
            row.appendChild(keyEl);
            row.appendChild(valueEl);
            infoContent.appendChild(row);
        }

        // Tree views
        this.buildTreeTab('Bones', introspection.bones);
        this.buildTreeTab('Slots', introspection.slots);
        this.buildTreeTab('Skins', introspection.skins);
        this.buildTreeTab('Events', introspection.events);
        this.buildTreeTab('Animations', introspection.animations);
        this.buildTreeTab('Constraints', introspection.constraints);
    }

    private buildTreeTab(category: string, nodes: TreeNode[]): void {
        const content = this.tabContents.get(category)!;
        content.innerHTML = '';

        const tree = new TreeView({
            searchable: true,
            onSelect: (node) => this.onNodeSelected(node),
        });
        tree.setData(nodes);
        content.appendChild(tree.element);
    }

    private onNodeSelected(node: TreeNode): void {
        // Show details
        this.detailPanel.innerHTML = '';
        if (node.data) {
            for (const [key, value] of Object.entries(node.data)) {
                const row = document.createElement('div');
                row.className = 'sv-detail-row';
                const keyEl = document.createElement('span');
                keyEl.className = 'sv-detail-key';
                keyEl.textContent = key;
                const valueEl = document.createElement('span');
                valueEl.className = 'sv-detail-value';
                valueEl.textContent = String(value);
                row.appendChild(keyEl);
                row.appendChild(valueEl);
                this.detailPanel.appendChild(row);
            }
        }

        // Highlight bone/slot in viewport
        this.highlightNode(node);

        // If animation, play it
        if (node.data?.type === 'animation') {
            this.spineManager.setAnimation(0, node.label, true);
        }

        // If skin, apply it
        if (node.data?.type === 'skin') {
            this.spineManager.setSkin(node.label);
        }
    }

    private highlightNode(node: TreeNode): void {
        this.clearHighlight();
        if (!this.spineManager.spine) return;

        const spine = this.spineManager.spine;

        if (node.data?.type === 'bone') {
            const bone = spine.skeleton.findBone(node.label);
            if (bone) {
                this.highlightGraphics = new Graphics();
                this.highlightGraphics.zIndex = 1000;
                // Draw circle at bone position
                this.highlightGraphics.lineStyle(2, 0xff4444, 0.8);
                this.highlightGraphics.drawCircle(bone.worldX, bone.worldY, 8);
                // Draw bone line
                if (bone.data.length > 0) {
                    const angle = bone.getWorldRotationX() * Math.PI / 180;
                    const endX = bone.worldX + Math.cos(angle) * bone.data.length;
                    const endY = bone.worldY + Math.sin(angle) * bone.data.length;
                    this.highlightGraphics.moveTo(bone.worldX, bone.worldY);
                    this.highlightGraphics.lineTo(endX, endY);
                }
                spine.addChild(this.highlightGraphics);
            }
        } else if (node.data?.type === 'slot') {
            const slot = spine.skeleton.findSlot(node.label);
            if (slot && slot.bone) {
                this.highlightGraphics = new Graphics();
                this.highlightGraphics.zIndex = 1000;
                this.highlightGraphics.lineStyle(2, 0x44ff44, 0.8);
                this.highlightGraphics.drawCircle(slot.bone.worldX, slot.bone.worldY, 10);
                this.highlightGraphics.beginFill(0x44ff44, 0.2);
                this.highlightGraphics.drawCircle(slot.bone.worldX, slot.bone.worldY, 10);
                this.highlightGraphics.endFill();
                spine.addChild(this.highlightGraphics);
            }
        }
    }

    private clearHighlight(): void {
        if (this.highlightGraphics) {
            this.highlightGraphics.destroy();
            this.highlightGraphics = null;
        }
    }
}
