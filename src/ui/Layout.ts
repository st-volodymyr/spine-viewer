import { eventBus } from '../core/EventBus';
import type { StateManager } from '../core/StateManager';
import type { SpineManager } from '../core/SpineManager';

export class Layout {
    root: HTMLElement;
    toolbar: HTMLElement;
    leftPanel: HTMLElement;
    viewport: HTMLElement;
    rightPanel: HTMLElement;
    bottomBar: HTMLElement;
    canvas: HTMLCanvasElement;

    // Bottom bar elements
    private fpsEl!: HTMLElement;
    private progressBar!: HTMLElement;
    private progressFill!: HTMLElement;
    private trackInfoEl!: HTMLElement;
    private versionEl!: HTMLElement;
    private animTimeEl!: HTMLElement;

    // Right panel tabs
    private tabBar!: HTMLElement;
    private tabContent!: HTMLElement;
    private tabs: Map<string, HTMLElement> = new Map();
    private tabPanels: Map<string, HTMLElement> = new Map();

    constructor(
        container: HTMLElement,
        private stateManager: StateManager,
    ) {
        this.root = document.createElement('div');
        this.root.className = 'sv-app';

        // Toolbar
        this.toolbar = document.createElement('div');
        this.toolbar.className = 'sv-toolbar';
        this.root.appendChild(this.toolbar);

        // Left panel
        this.leftPanel = document.createElement('div');
        this.leftPanel.className = 'sv-left-panel';
        this.root.appendChild(this.leftPanel);

        // Viewport
        this.viewport = document.createElement('div');
        this.viewport.className = 'sv-viewport';
        this.canvas = document.createElement('canvas');
        this.viewport.appendChild(this.canvas);
        this.root.appendChild(this.viewport);

        // Right panel
        this.rightPanel = document.createElement('div');
        this.rightPanel.className = 'sv-right-panel';
        this.root.appendChild(this.rightPanel);

        // Bottom bar
        this.bottomBar = document.createElement('div');
        this.bottomBar.className = 'sv-bottombar';
        this.root.appendChild(this.bottomBar);

        container.appendChild(this.root);

        this.buildToolbar();
        this.buildRightPanelTabs();
        this.buildBottomBar();
    }

    private buildToolbar(): void {
        // Title
        const title = document.createElement('span');
        title.textContent = 'Spine Viewer';
        title.style.fontWeight = '600';
        title.style.marginRight = '12px';
        this.toolbar.appendChild(title);

        // Separator
        this.toolbar.appendChild(this.createSeparator());

        // File buttons are added by App after creation
        // Placeholder for file buttons
        const fileGroup = document.createElement('div');
        fileGroup.id = 'sv-toolbar-file-group';
        fileGroup.style.display = 'flex';
        fileGroup.style.gap = '4px';
        this.toolbar.appendChild(fileGroup);

        this.toolbar.appendChild(this.createSeparator());

        // BG color
        const bgLabel = document.createElement('span');
        bgLabel.textContent = 'BG:';
        bgLabel.className = 'sv-control-label';
        this.toolbar.appendChild(bgLabel);

        const bgInput = document.createElement('input');
        bgInput.type = 'color';
        bgInput.className = 'sv-color-input';
        bgInput.value = this.stateManager.viewport.bgColor;
        bgInput.addEventListener('input', () => {
            this.stateManager.setViewport({ bgColor: bgInput.value });
        });
        this.toolbar.appendChild(bgInput);

        // Grid toggle
        const gridBtn = document.createElement('button');
        gridBtn.className = 'sv-btn sv-btn-sm sv-btn-icon';
        gridBtn.textContent = '#';
        gridBtn.title = 'Toggle Grid';
        gridBtn.addEventListener('click', () => {
            this.stateManager.setViewport({ showGrid: !this.stateManager.viewport.showGrid });
            gridBtn.style.opacity = this.stateManager.viewport.showGrid ? '1' : '0.5';
        });
        this.toolbar.appendChild(gridBtn);

        // Spacer
        const spacer = document.createElement('div');
        spacer.style.flex = '1';
        this.toolbar.appendChild(spacer);

        // Reset view button
        const resetBtn = document.createElement('button');
        resetBtn.className = 'sv-btn sv-btn-sm';
        resetBtn.textContent = 'Reset View';
        resetBtn.addEventListener('click', () => {
            eventBus.emit('viewport:reset');
        });
        this.toolbar.appendChild(resetBtn);
    }

    private buildRightPanelTabs(): void {
        this.tabBar = document.createElement('div');
        this.tabBar.className = 'sv-tabs';
        this.rightPanel.appendChild(this.tabBar);

        this.tabContent = document.createElement('div');
        this.tabContent.className = 'sv-tab-content';
        this.rightPanel.appendChild(this.tabContent);
    }

    addTab(id: string, label: string, content: HTMLElement): void {
        const tab = document.createElement('div');
        tab.className = 'sv-tab';
        tab.textContent = label;
        tab.addEventListener('click', () => this.activateTab(id));
        this.tabBar.appendChild(tab);
        this.tabs.set(id, tab);

        const panel = document.createElement('div');
        panel.style.display = 'none';
        panel.appendChild(content);
        this.tabContent.appendChild(panel);
        this.tabPanels.set(id, panel);

        // Activate first tab
        if (this.tabs.size === 1) {
            this.activateTab(id);
        }
    }

    activateTab(id: string): void {
        this.tabs.forEach((tab, key) => {
            tab.classList.toggle('active', key === id);
        });
        this.tabPanels.forEach((panel, key) => {
            panel.style.display = key === id ? 'block' : 'none';
        });
        this.stateManager.setActiveTab(id);
    }

    private buildBottomBar(): void {
        // FPS
        this.fpsEl = document.createElement('span');
        this.fpsEl.className = 'sv-bottombar-item';
        this.fpsEl.textContent = 'FPS: --';
        this.bottomBar.appendChild(this.fpsEl);

        this.bottomBar.appendChild(this.createSeparatorVertical());

        // Progress
        const progressWrap = document.createElement('div');
        progressWrap.className = 'sv-bottombar-item';
        this.progressBar = document.createElement('div');
        this.progressBar.className = 'sv-progress-bar';
        this.progressFill = document.createElement('div');
        this.progressFill.className = 'sv-progress-fill';
        this.progressFill.style.width = '0%';
        this.progressBar.appendChild(this.progressFill);
        progressWrap.appendChild(this.progressBar);
        this.bottomBar.appendChild(progressWrap);

        // Animation time
        this.animTimeEl = document.createElement('span');
        this.animTimeEl.className = 'sv-bottombar-item';
        this.animTimeEl.textContent = '';
        this.bottomBar.appendChild(this.animTimeEl);

        this.bottomBar.appendChild(this.createSeparatorVertical());

        // Track info
        this.trackInfoEl = document.createElement('span');
        this.trackInfoEl.className = 'sv-bottombar-item';
        this.trackInfoEl.textContent = 'No animation';
        this.bottomBar.appendChild(this.trackInfoEl);

        // Spacer
        const spacer = document.createElement('div');
        spacer.className = 'sv-bottombar-spacer';
        this.bottomBar.appendChild(spacer);

        // Version
        this.versionEl = document.createElement('span');
        this.versionEl.className = 'sv-bottombar-item';
        this.versionEl.textContent = '';
        this.bottomBar.appendChild(this.versionEl);
    }

    updateFPS(fps: number): void {
        this.fpsEl.textContent = `FPS: ${fps}`;
    }

    updateProgress(progress: number): void {
        this.progressFill.style.width = `${Math.min(100, Math.max(0, progress * 100))}%`;
    }

    updateTrackInfo(info: string): void {
        this.trackInfoEl.textContent = info;
    }

    updateAnimTime(time: string): void {
        this.animTimeEl.textContent = time;
    }

    updateVersion(version: string): void {
        this.versionEl.textContent = version;
    }

    private createSeparator(): HTMLElement {
        const sep = document.createElement('div');
        sep.style.width = '1px';
        sep.style.height = '20px';
        sep.style.background = 'var(--sv-border)';
        sep.style.margin = '0 4px';
        return sep;
    }

    private createSeparatorVertical(): HTMLElement {
        const sep = document.createElement('div');
        sep.style.width = '1px';
        sep.style.height = '14px';
        sep.style.background = 'var(--sv-border)';
        return sep;
    }
}
