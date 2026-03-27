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
import { ComparisonControlPanel } from '../ui/panels/ComparisonControlPanel';
import { QuickAccessPanel } from '../ui/panels/QuickAccessPanel';
import { ActiveTracksBar } from '../ui/panels/ActiveTracksBar';
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
    private quickAccessEl!: HTMLElement;
    private comparisonControlEl!: HTMLElement;
    private comparisonPanel!: ComparisonPanel;
    private wasPausedBeforeCompare = false;

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

        // Mode switching: hide/show main spine, swap left panel, hide drop zone
        eventBus.on('mode:change', (mode: string) => {
            if (mode === 'comparison') {
                // Remember pause state and stop main spine
                if (this.spineManager.spine) {
                    this.wasPausedBeforeCompare = this.stateManager.projectA?.paused ?? false;
                    this.spineManager.setPaused(true);
                    this.spineManager.spine.visible = false;
                }
                // Hide drop zone in compare mode
                if (this.dropZone) {
                    this.dropZone.style.display = 'none';
                }
                this.quickAccessEl.style.display = 'none';
                this.comparisonControlEl.style.display = 'block';
            } else {
                // Restore main spine
                if (this.spineManager.spine) {
                    this.spineManager.spine.visible = true;
                    this.spineManager.setPaused(this.wasPausedBeforeCompare);
                }
                // Restore drop zone visibility (only show if no project loaded)
                if (this.dropZone) {
                    this.dropZone.style.display = '';
                }
                this.quickAccessEl.style.display = 'block';
                this.comparisonControlEl.style.display = 'none';
            }
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
                    if (this.stateManager.mode === 'comparison') {
                        // Toggle pause on all comparison spines
                        const projects = this.comparisonPanel.getProjects();
                        if (projects.length > 0) {
                            const firstSpine = projects[0].manager.spine;
                            const shouldPause = firstSpine ? (firstSpine as any).autoUpdate !== false : true;
                            this.comparisonPanel.setAllPaused(shouldPause);
                        }
                    } else {
                        const project = this.stateManager.projectA;
                        if (project) {
                            const paused = !project.paused;
                            this.spineManager.setPaused(paused);
                            this.stateManager.updateProjectA({ paused });
                            const btn = document.getElementById('sv-pause-btn');
                            if (btn) btn.textContent = paused ? 'Resume' : 'Pause';
                        }
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
        // Open button - opens file picker (accepts files, auto-detects)
        const openBtn = document.getElementById('sv-toolbar-open-btn');
        if (openBtn) {
            openBtn.addEventListener('click', () => {
                const input = createFileInput(true, (files) => this.handleFiles(files));
                input.click();
            });
        }

        // "Add Project" button (toolbar, compare mode)
        const addProjectBtn = document.getElementById('sv-toolbar-add-project');
        if (addProjectBtn) {
            addProjectBtn.addEventListener('click', () => {
                this.comparisonPanel.addProjectFromToolbar();
            });
        }
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

        this.comparisonPanel = new ComparisonPanel(this.viewport);
        this.layout.addTab('comparison', 'Compare', this.comparisonPanel.element);

        // Left panel: QuickAccessPanel + ComparisonControlPanel (toggled by mode)
        const quickAccess = new QuickAccessPanel(this.stateManager, this.spineManager);
        const comparisonControls = new ComparisonControlPanel(this.comparisonPanel);
        comparisonControls.element.style.display = 'none';

        this.layout.leftPanel.appendChild(quickAccess.element);
        this.layout.leftPanel.appendChild(comparisonControls.element);

        this.quickAccessEl = quickAccess.element;
        this.comparisonControlEl = comparisonControls.element;

        // Active tracks bar below viewport
        new ActiveTracksBar(this.layout.viewportTracksBar, this.stateManager, this.spineManager);
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
            this.layout.updateProjectName(project.name);

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

            // Compute which atlas regions are referenced by skins
            const usedRegionNames = new Set<string>();
            const spineData = this.spineManager.spineData as any;
            if (spineData?.skins) {
                for (const skin of spineData.skins) {
                    const attachments = typeof skin.getAttachments === 'function' ? skin.getAttachments() : [];
                    for (const entry of attachments) {
                        const att = entry.attachment;
                        if (att) {
                            const regionPath = att.path || att.name;
                            if (regionPath) usedRegionNames.add(regionPath);
                        }
                    }
                }
            }

            // Emit atlas data for atlas inspector
            const parsedAtlas = parseAtlasText(fileSet.atlas.data);
            eventBus.emit('atlas:loaded', { atlas: parsedAtlas, textures: fileSet.textures, usedRegionNames });

            this.showToast(`Loaded: ${fileSet.skeleton.name}`, 'success');

        } catch (err: any) {
            console.error('Failed to load spine files:', err);
            this.showToast(`Error: ${err.message || err}`, 'error');
        }
    }

    private updateBottomBar(): void {
        // FPS
        this.layout.updateFPS(Math.round(this.viewport.ticker.FPS));

        if (this.stateManager.mode === 'comparison') {
            const projects = this.comparisonPanel.getProjects();
            this.layout.updateTrackInfo(`Compare: ${projects.length} project${projects.length !== 1 ? 's' : ''}`);
            this.layout.updateProgress(0);
            this.layout.updateAnimTime('');
            return;
        }

        // Track info
        const trackInfo = this.spineManager.getCurrentTrackInfo(
            this.stateManager.projectA?.currentTrack ?? 0
        );
        if (trackInfo) {
            this.layout.updateTrackInfo(
                `Track ${this.stateManager.projectA?.currentTrack ?? 0}: ${trackInfo.name} ${trackInfo.loop ? '(loop)' : ''}`
            );
            this.layout.updateProgress(trackInfo.duration > 0 ? trackInfo.time / trackInfo.duration : 0);
            this.layout.updateAnimTime(
                `${trackInfo.time.toFixed(2)}s / ${trackInfo.duration.toFixed(2)}s`
            );
        } else {
            this.layout.updateTrackInfo(this.stateManager.projectA ? 'No animation' : 'No project loaded');
            this.layout.updateProgress(0);
            this.layout.updateAnimTime('');
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
