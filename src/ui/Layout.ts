import { eventBus } from '../core/EventBus';
import type { StateManager } from '../core/StateManager';

export class Layout {
    root: HTMLElement;
    toolbar: HTMLElement;
    leftPanel: HTMLElement;
    viewport: HTMLElement;
    viewportTracksBar: HTMLElement;
    rightPanel: HTMLElement;
    bottomBar: HTMLElement;
    canvas: HTMLCanvasElement;

    // BG color picker overlay in viewport
    bgColorInput!: HTMLInputElement;

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

    // Toolbar elements that change with mode
    private addProjectBtn!: HTMLElement;
    private compareBtn!: HTMLElement;
    private themeBtn!: HTMLElement;
    private projectNameEl!: HTMLElement;

    constructor(
        container: HTMLElement,
        private stateManager: StateManager,
    ) {
        this.root = document.createElement('div');
        this.root.className = 'sv-app';

        // Apply saved theme (light is default)
        const savedTheme = localStorage.getItem('sv-theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);

        // Toolbar
        this.toolbar = document.createElement('div');
        this.toolbar.className = 'sv-toolbar';
        this.root.appendChild(this.toolbar);

        // Left panel
        this.leftPanel = document.createElement('div');
        this.leftPanel.className = 'sv-left-panel';
        this.root.appendChild(this.leftPanel);

        // Viewport wrapper (flex column: canvas area + tracks bar)
        const viewportWrapper = document.createElement('div');
        viewportWrapper.className = 'sv-viewport-wrapper';

        this.viewport = document.createElement('div');
        this.viewport.className = 'sv-viewport';
        this.canvas = document.createElement('canvas');
        this.viewport.appendChild(this.canvas);

        // Viewport tools overlay (bottom-right): grid toggle + BG color picker
        const viewportTools = document.createElement('div');
        viewportTools.className = 'sv-viewport-tools';
        // Prevent click/pointer events from reaching the canvas (pan)
        viewportTools.addEventListener('pointerdown', (e) => e.stopPropagation());
        viewportTools.addEventListener('click', (e) => e.stopPropagation());

        // Grid toggle
        const gridBtn = document.createElement('button');
        gridBtn.className = 'sv-btn sv-btn-sm sv-btn-icon';
        gridBtn.textContent = '#';
        gridBtn.title = 'Toggle Grid';
        gridBtn.style.opacity = this.stateManager.viewport.showGrid ? '1' : '0.4';
        gridBtn.addEventListener('click', () => {
            this.stateManager.setViewport({ showGrid: !this.stateManager.viewport.showGrid });
            gridBtn.style.opacity = this.stateManager.viewport.showGrid ? '1' : '0.4';
        });
        viewportTools.appendChild(gridBtn);

        // BG color picker
        this.bgColorInput = document.createElement('input');
        this.bgColorInput.type = 'color';
        this.bgColorInput.className = 'sv-color-input';
        this.bgColorInput.title = 'Background color';
        this.bgColorInput.value = this.stateManager.viewport.bgColor;
        this.bgColorInput.addEventListener('input', () => {
            this.stateManager.setViewport({ bgColor: this.bgColorInput.value });
        });
        viewportTools.appendChild(this.bgColorInput);

        this.viewport.appendChild(viewportTools);

        viewportWrapper.appendChild(this.viewport);

        // Active tracks bar below canvas
        this.viewportTracksBar = document.createElement('div');
        this.viewportTracksBar.className = 'sv-tracks-bar';
        viewportWrapper.appendChild(this.viewportTracksBar);

        this.root.appendChild(viewportWrapper);

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

        // Update toolbar buttons when mode changes
        eventBus.on('mode:change', (mode: string) => {
            this.updateToolbarForMode(mode as 'single' | 'comparison');
        });
    }

    private buildToolbar(): void {
        // Theme toggle (left corner)
        this.themeBtn = document.createElement('button');
        this.themeBtn.className = 'sv-btn sv-btn-sm sv-btn-icon';
        this.themeBtn.title = 'Toggle light/dark theme';
        this.updateThemeButton();
        this.themeBtn.addEventListener('click', () => this.toggleTheme());
        this.toolbar.appendChild(this.themeBtn);

        // Title
        const title = document.createElement('span');
        title.textContent = 'Spine Viewer';
        title.style.fontWeight = '600';
        title.style.fontSize = '13px';
        title.style.color = 'var(--sv-text-secondary)';
        this.toolbar.appendChild(title);

        this.toolbar.appendChild(this.createSeparator());

        // Open button (bigger, not sv-btn-sm)
        const openBtn = document.createElement('button');
        openBtn.className = 'sv-btn sv-btn-primary';
        openBtn.id = 'sv-toolbar-open-btn';
        openBtn.textContent = 'Open';
        openBtn.title = 'Open spine files or folder';
        this.toolbar.appendChild(openBtn);

        // Add Project button (visible only in compare mode)
        this.addProjectBtn = document.createElement('button');
        this.addProjectBtn.className = 'sv-btn sv-btn-sm';
        this.addProjectBtn.textContent = '+ Add';
        this.addProjectBtn.title = 'Add spine project to comparison';
        this.addProjectBtn.id = 'sv-toolbar-add-project';
        this.addProjectBtn.style.display = 'none';
        this.toolbar.appendChild(this.addProjectBtn);

        this.toolbar.appendChild(this.createSeparator());

        // Perf button
        const perfBtn = document.createElement('button');
        perfBtn.className = 'sv-btn';
        perfBtn.id = 'sv-perf-btn';
        perfBtn.textContent = 'Perf';
        perfBtn.title = 'Performance stats';
        this.toolbar.appendChild(perfBtn);

        // Project name chip
        this.projectNameEl = document.createElement('span');
        this.projectNameEl.className = 'sv-project-chip';
        this.projectNameEl.style.display = 'none';
        this.toolbar.appendChild(this.projectNameEl);

        // Spacer
        const spacer = document.createElement('div');
        spacer.style.flex = '1';
        this.toolbar.appendChild(spacer);

        // Compare toggle button
        this.compareBtn = document.createElement('button');
        this.compareBtn.className = 'sv-btn sv-btn-compare';
        this.compareBtn.textContent = 'Compare';
        this.compareBtn.title = 'Toggle comparison mode';
        this.compareBtn.addEventListener('click', () => {
            if (this.stateManager.mode === 'comparison') {
                this.stateManager.setMode('single');
            } else {
                this.stateManager.setMode('comparison');
                this.activateTab('comparison');
            }
        });
        this.toolbar.appendChild(this.compareBtn);

        this.toolbar.appendChild(this.createSeparator());

        // Reset view
        const resetBtn = document.createElement('button');
        resetBtn.className = 'sv-btn sv-btn-sm';
        resetBtn.textContent = 'Reset';
        resetBtn.title = 'Re-center the viewport (keyboard: 0)';
        resetBtn.addEventListener('click', () => {
            eventBus.emit('viewport:reset');
        });
        this.toolbar.appendChild(resetBtn);

        // Clear All
        const clearBtn = document.createElement('button');
        clearBtn.className = 'sv-btn sv-btn-sm';
        clearBtn.textContent = 'Clear';
        clearBtn.title = 'Unload current spine and reset';
        clearBtn.addEventListener('click', () => {
            if (confirm('Clear all and reload?')) {
                window.location.reload();
            }
        });
        this.toolbar.appendChild(clearBtn);
    }

    private toggleTheme(): void {
        const current = document.documentElement.getAttribute('data-theme') || 'light';
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('sv-theme', next);
        this.updateThemeButton();
    }

    private updateThemeButton(): void {
        const isDark = (document.documentElement.getAttribute('data-theme') || 'light') === 'dark';
        this.themeBtn.textContent = isDark ? '\u263E' : '\u2600';
    }

    private updateToolbarForMode(mode: 'single' | 'comparison'): void {
        if (mode === 'comparison') {
            this.compareBtn.classList.add('sv-btn-active');
            this.compareBtn.classList.remove('sv-btn-compare');
            this.compareBtn.textContent = 'Exit Compare';
            this.addProjectBtn.style.display = '';
        } else {
            this.compareBtn.classList.remove('sv-btn-active');
            this.compareBtn.classList.add('sv-btn-compare');
            this.compareBtn.textContent = 'Compare';
            this.addProjectBtn.style.display = 'none';
        }
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
        this.fpsEl = document.createElement('span');
        this.fpsEl.className = 'sv-bottombar-item';
        this.fpsEl.textContent = 'FPS: --';
        this.bottomBar.appendChild(this.fpsEl);

        this.bottomBar.appendChild(this.createSeparatorVertical());

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

        this.animTimeEl = document.createElement('span');
        this.animTimeEl.className = 'sv-bottombar-item';
        this.animTimeEl.textContent = '';
        this.bottomBar.appendChild(this.animTimeEl);

        this.bottomBar.appendChild(this.createSeparatorVertical());

        this.trackInfoEl = document.createElement('span');
        this.trackInfoEl.className = 'sv-bottombar-item';
        this.trackInfoEl.textContent = 'No animation';
        this.bottomBar.appendChild(this.trackInfoEl);

        const spacer = document.createElement('div');
        spacer.className = 'sv-bottombar-spacer';
        this.bottomBar.appendChild(spacer);

        this.versionEl = document.createElement('span');
        this.versionEl.className = 'sv-bottombar-item';
        this.versionEl.textContent = '';
        this.bottomBar.appendChild(this.versionEl);
    }

    updateProjectName(name: string | null): void {
        if (name) {
            this.projectNameEl.textContent = name;
            this.projectNameEl.style.display = '';
        } else {
            this.projectNameEl.style.display = 'none';
        }
    }
    updateFPS(fps: number): void { this.fpsEl.textContent = `FPS: ${fps}`; }
    updateProgress(progress: number): void { this.progressFill.style.width = `${Math.min(100, Math.max(0, progress * 100))}%`; }
    updateTrackInfo(info: string): void { this.trackInfoEl.textContent = info; }
    updateAnimTime(time: string): void { this.animTimeEl.textContent = time; }
    updateVersion(version: string): void { this.versionEl.textContent = version; }

    private createSeparator(): HTMLElement {
        const sep = document.createElement('div');
        sep.style.width = '1px';
        sep.style.height = '22px';
        sep.style.background = 'var(--sv-border)';
        sep.style.margin = '0 4px';
        return sep;
    }

    private createSeparatorVertical(): HTMLElement {
        const sep = document.createElement('div');
        sep.style.width = '1px';
        sep.style.height = '12px';
        sep.style.background = 'var(--sv-border)';
        return sep;
    }
}
