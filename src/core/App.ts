import { StateManager } from './StateManager';
import { SpineManager } from './SpineManager';
import { Viewport } from './Viewport';
import { eventBus } from './EventBus';
import { Layout } from '../ui/Layout';
import { SkeletonInspectorPanel } from '../ui/panels/SkeletonInspector';
import { PlaceholderPanel } from '../ui/panels/PlaceholderPanel';
import { AtlasInspectorPanel } from '../ui/panels/AtlasInspector';
import { EventDebugPanel } from '../ui/panels/EventDebugPanel';
import { ComparisonPanel } from '../ui/panels/ComparisonPanel';
import { QuickAccessPanel } from '../ui/panels/QuickAccessPanel';
import { PerformancePanel } from '../ui/panels/PerformancePanel';
import { loadSpineFiles, createFileInput, setupDragDrop } from '../services/FileLoader';
import { parseSpineFiles } from '../services/SpineParser';
import { detectSpineVersion } from '../services/SpineVersionDetector';
import { parseAtlasText } from '../services/AtlasParser';
import type { SpineFileSet } from '../types/spine';
import type { SpineProjectState } from '../types/state';

export class App {
    private stateManager: StateManager;
    private spineManager!: SpineManager;
    private viewport!: Viewport;
    private layout: Layout;
    private dropZone: HTMLElement | null = null;

    constructor(container: HTMLElement) {
        this.stateManager = new StateManager();
        this.layout = new Layout(container, this.stateManager);

        // Init viewport (PixiJS)
        this.viewport = new Viewport(this.layout.canvas, this.stateManager);
        this.spineManager = new SpineManager(this.viewport);

        // Build UI panels
        this.buildToolbarButtons();
        this.buildPanels();
        this.buildDropZone();
        this.buildPerformancePanel();

        // Event listeners
        eventBus.on('viewport:reset', () => {
            this.viewport.centerWrapper();
            this.viewport.wrapper.scale.set(1, 1);
            this.stateManager.setViewport({ zoom: 1 });
        });

        // FPS and progress updates
        this.viewport.ticker.add(() => this.updateBottomBar());

        // Keyboard shortcuts
        this.setupKeyboardShortcuts();
    }

    private setupKeyboardShortcuts(): void {
        window.addEventListener('keydown', (e) => {
            // Don't capture when typing in inputs
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) {
                return;
            }

            switch (e.code) {
                case 'Space': {
                    e.preventDefault();
                    const project = this.stateManager.projectA;
                    if (project) {
                        const paused = !project.paused;
                        this.spineManager.setPaused(paused);
                        this.stateManager.updateProjectA({ paused });
                        const btn = document.getElementById('sv-pause-btn');
                        if (btn) btn.textContent = paused ? 'Resume' : 'Pause';
                    }
                    break;
                }
                case 'KeyR':
                    if (!e.ctrlKey && !e.metaKey) {
                        this.spineManager.resetPose();
                    }
                    break;
                case 'Equal':
                case 'NumpadAdd': {
                    e.preventDefault();
                    const newZoom = Math.min(10, this.viewport.wrapper.scale.x * 1.2);
                    this.viewport.wrapper.scale.set(newZoom, newZoom);
                    this.stateManager.setViewport({ zoom: newZoom });
                    break;
                }
                case 'Minus':
                case 'NumpadSubtract': {
                    e.preventDefault();
                    const newZoom = Math.max(0.05, this.viewport.wrapper.scale.x * 0.8);
                    this.viewport.wrapper.scale.set(newZoom, newZoom);
                    this.stateManager.setViewport({ zoom: newZoom });
                    break;
                }
                case 'Digit0':
                case 'Numpad0': {
                    e.preventDefault();
                    eventBus.emit('viewport:reset');
                    break;
                }
            }
        });
    }

    private buildToolbarButtons(): void {
        const group = document.getElementById('sv-toolbar-file-group');
        if (!group) return;

        // Open Files button
        const openBtn = document.createElement('button');
        openBtn.className = 'sv-btn sv-btn-sm';
        openBtn.textContent = 'Open Files';
        openBtn.addEventListener('click', () => {
            const input = createFileInput(true, (files) => this.handleFiles(files));
            input.click();
        });
        group.appendChild(openBtn);

        // Open Folder button
        const folderBtn = document.createElement('button');
        folderBtn.className = 'sv-btn sv-btn-sm';
        folderBtn.textContent = 'Open Folder';
        folderBtn.addEventListener('click', () => {
            const input = createFileInput(true, (files) => this.handleFiles(files), true);
            input.click();
        });
        group.appendChild(folderBtn);
    }

    private buildPanels(): void {
        const skeletonInspector = new SkeletonInspectorPanel(this.spineManager);
        this.layout.addTab('inspect', 'Inspect', skeletonInspector.element);

        const atlasInspector = new AtlasInspectorPanel();
        this.layout.addTab('atlas', 'Atlas', atlasInspector.element);

        const placeholderPanel = new PlaceholderPanel(this.stateManager, this.spineManager);
        this.layout.addTab('placeholders', 'Slots', placeholderPanel.element);

        const eventPanel = new EventDebugPanel();
        this.layout.addTab('events', 'Events', eventPanel.element);

        const comparisonPanel = new ComparisonPanel(this.viewport);
        this.layout.addTab('comparison', 'Compare', comparisonPanel.element);

        // Left panel: ONLY QuickAccessPanel
        const quickAccess = new QuickAccessPanel(this.stateManager, this.spineManager);
        this.layout.leftPanel.appendChild(quickAccess.element);
    }

    private buildPerformancePanel(): void {
        const perfPanel = new PerformancePanel(this.viewport, this.spineManager);
        const perfBtn = document.getElementById('sv-perf-btn');
        if (perfBtn) perfBtn.addEventListener('click', () => perfPanel.toggle());
    }

    private buildDropZone(): void {
        this.dropZone = document.createElement('div');
        this.dropZone.className = 'sv-drop-zone';

        const icon = document.createElement('div');
        icon.className = 'sv-drop-zone-icon';
        icon.textContent = '\u{1F9B4}'; // bone emoji
        this.dropZone.appendChild(icon);

        const text = document.createElement('div');
        text.className = 'sv-drop-zone-text';
        text.textContent = 'Drop spine files here or use the buttons above';
        this.dropZone.appendChild(text);

        const subtext = document.createElement('div');
        subtext.style.fontSize = 'var(--sv-font-size-sm)';
        subtext.style.color = 'var(--sv-text-muted)';
        subtext.textContent = 'Supports .json, .skel, .atlas, .png, .jpg, .avif, .spine';
        this.dropZone.appendChild(subtext);

        const buttons = document.createElement('div');
        buttons.className = 'sv-drop-zone-buttons';

        const openBtn = document.createElement('button');
        openBtn.className = 'sv-btn sv-btn-primary';
        openBtn.textContent = 'Open Files';
        openBtn.addEventListener('click', () => {
            const input = createFileInput(true, (files) => this.handleFiles(files));
            input.click();
        });
        buttons.appendChild(openBtn);

        const folderBtn = document.createElement('button');
        folderBtn.className = 'sv-btn';
        folderBtn.textContent = 'Open Folder';
        folderBtn.addEventListener('click', () => {
            const input = createFileInput(true, (files) => this.handleFiles(files), true);
            input.click();
        });
        buttons.appendChild(folderBtn);

        this.dropZone.appendChild(buttons);
        this.layout.viewport.appendChild(this.dropZone);

        // Setup drag-drop on viewport
        setupDragDrop(this.layout.viewport, (files) => this.handleFiles(files));
    }

    private async handleFiles(files: FileList): Promise<void> {
        try {
            this.showToast('Loading spine files...', 'info');

            const fileSet: SpineFileSet = await loadSpineFiles(files);
            const versionInfo = detectSpineVersion(fileSet);

            if (versionInfo.detected === '4.1') {
                this.showToast('Spine 4.1 detected — loading with 4.1 runtime', 'info');
            }

            const result = await parseSpineFiles(fileSet, versionInfo.detected === '4.1' ? '4.1' : '4.2');
            if (result.runtimeVersion === '4.1') {
                this.spineManager.createSpine41(result.skeletonData as any);
            } else {
                this.spineManager.createSpine(result.projectName);
            }

            // Build project state
            const project: SpineProjectState = {
                name: fileSet.skeleton.name,
                version: versionInfo.detected,
                fullVersion: versionInfo.fullVersion,
                currentTrack: 0,
                tracks: [],
                speed: 1,
                paused: false,
                scale: 1,
                flipX: false,
                flipY: false,
                currentSkin: this.spineManager.getSkinNames()[0] ?? 'default',
                animationNames: this.spineManager.getAnimationNames(),
                skinNames: this.spineManager.getSkinNames(),
                boneNames: this.spineManager.getBoneNames(),
                slotNames: this.spineManager.getSlotNames(),
                eventNames: this.spineManager.getEventNames(),
            };

            this.stateManager.setProjectA(project);

            // Hide drop zone
            if (this.dropZone) {
                this.dropZone.classList.add('sv-hidden');
            }

            // Set default skin and first animation
            if (project.skinNames.length > 0) {
                this.spineManager.setSkin(project.skinNames[0]);
            }
            if (project.animationNames.length > 0) {
                this.spineManager.setAnimation(0, project.animationNames[0], true);
            }

            // Update version in bottom bar
            this.layout.updateVersion(
                `Spine ${versionInfo.fullVersion || versionInfo.detected}`
            );

            // Emit atlas data for atlas inspector
            const parsedAtlas = parseAtlasText(fileSet.atlas.data);
            eventBus.emit('atlas:loaded', { atlas: parsedAtlas, textures: fileSet.textures });

            this.showToast(`Loaded: ${fileSet.skeleton.name}`, 'success');

        } catch (err: any) {
            console.error('Failed to load spine files:', err);
            this.showToast(`Error: ${err.message || err}`, 'error');
        }
    }

    private updateBottomBar(): void {
        // FPS
        this.layout.updateFPS(Math.round(this.viewport.ticker.FPS));

        // Track info
        const trackInfo = this.spineManager.getCurrentTrackInfo(
            this.stateManager.projectA?.currentTrack ?? 0
        );
        if (trackInfo) {
            this.layout.updateTrackInfo(
                `Track ${this.stateManager.projectA?.currentTrack ?? 0}: ${trackInfo.name} ${trackInfo.loop ? '(loop)' : ''}`
            );
            this.layout.updateProgress(trackInfo.time / trackInfo.duration);
            this.layout.updateAnimTime(
                `${trackInfo.time.toFixed(2)}s / ${trackInfo.duration.toFixed(2)}s`
            );
        }
    }

    private toastContainer: HTMLElement | null = null;

    private showToast(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
        if (!this.toastContainer) {
            this.toastContainer = document.createElement('div');
            this.toastContainer.className = 'sv-toast-container';
            document.body.appendChild(this.toastContainer);
        }

        const toast = document.createElement('div');
        toast.className = `sv-toast ${type}`;
        toast.textContent = message;
        this.toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
}
