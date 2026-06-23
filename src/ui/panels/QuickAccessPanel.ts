import { eventBus } from '../../core/EventBus';
import type { StateManager } from '../../core/StateManager';
import type { SpineManager, DebugDrawOptions } from '../../core/SpineManager';
import type { SpineEventData } from '../../core/SpineManager';
import type { AnimationCost, Severity } from '../../services/AnimationProfiler';

const SEVERITY_COLOR: Record<Severity, string> = {
    ok: '#4a9a5a',
    watch: '#c08a30',
    heavy: '#c05050',
};

interface EventTrigger {
    id: number;
    eventName: string;
    trackIndex: number;
    animationName: string;
    loop: boolean;
}

export class QuickAccessPanel {
    element: HTMLElement;

    // Animations
    private animList!: HTMLElement;
    private animBadge!: HTMLElement;
    private animTag!: HTMLElement;
    private loopToggle!: HTMLInputElement;
    private trackPills: HTMLButtonElement[] = [];
    private currentAnim = '';
    private currentTrack = 0;
    private animCosts = new Map<string, AnimationCost>();

    // Skins. Single-select by default; opt into combining N skins via the toggle.
    private skinList!: HTMLElement;
    private skinBadge!: HTMLElement;
    private skinHint!: HTMLElement;
    private multiSkinToggle!: HTMLInputElement;
    private multiSkin = false;
    private currentSkins = new Set<string>();

    // Debug draw
    private debug: DebugDrawOptions = {
        bones: false,
        meshes: false,
        boundingBoxes: false,
        regions: false,
        clipping: false,
        paths: false,
    };

    // Playback
    private pauseBtn!: HTMLButtonElement;
    private speedSlider!: HTMLInputElement;
    private speedValue!: HTMLElement;
    private scaleSlider!: HTMLInputElement;
    private scaleValue!: HTMLElement;
    private isPaused = false;
    private mixDuration = 0;

    // Queue
    private queueListEl!: HTMLElement;
    private queue: string[] = [];

    // Event triggers
    private triggers: EventTrigger[] = [];
    private triggerIdCounter = 0;
    private triggerListEl!: HTMLElement;
    private triggerEventSelect!: HTMLSelectElement;
    private triggerTrackSelect!: HTMLSelectElement;
    private triggerAnimSelect!: HTMLSelectElement;
    private triggerLoopToggle!: HTMLInputElement;

    constructor(
        private stateManager: StateManager,
        private spineManager: SpineManager,
    ) {
        this.element = document.createElement('div');
        this.build();

        eventBus.on('project:change', () => {
            this.currentAnim = '';
            this.currentSkins.clear();
            this.currentTrack = 0;
            this.isPaused = false;
            this.queue = [];
            this.triggers = [];
            this.refresh();
            // Re-apply persisted debug-draw + mix settings to the freshly created spine.
            this.spineManager.setDebugOptions(this.debug);
            this.spineManager.setDefaultMix(this.mixDuration);
        });

        eventBus.on('spine:event', (data: SpineEventData) => {
            if (data.type !== 'event') return;
            this.triggers.forEach(t => {
                if (t.eventName === data.eventName) {
                    this.spineManager.setAnimation(t.trackIndex, t.animationName, t.loop);
                    this.updateTrackPills();
                }
            });
        });

        // Keyboard-driven loop toggles (L / Shift+L).
        eventBus.on('loop:toggle-current', () => this.toggleLoopCurrent());
        eventBus.on('loop:toggle-all', () => this.toggleLoopAll());

        // Pose reset (button or R key) clears active animations → drop the stale chip.
        eventBus.on('pose:reset', () => {
            this.currentAnim = '';
            if (this.isPaused) {
                this.isPaused = false;
                this.spineManager.setPaused(false);
                this.pauseBtn.textContent = '⏸ Pause';
            }
            this.refresh();
        });

        // Pause state changed elsewhere (e.g. frame-step shortcut).
        eventBus.on('playback:paused-changed', (paused: boolean) => {
            this.isPaused = paused;
            this.pauseBtn.textContent = paused ? '▶ Resume' : '⏸ Pause';
        });

        // Keep the VIEW zoom slider in sync with wheel / keyboard / reset zoom.
        eventBus.on('viewport:change', () => {
            const zoom = this.stateManager.viewport.zoom;
            if (this.scaleSlider) {
                this.scaleSlider.value = String(zoom);
                this.scaleValue.textContent = zoom.toFixed(2) + 'x';
            }
        });
    }

    private build(): void {
        // ── ANIMATIONS ────────────────────────────────────────────────
        const animSection = document.createElement('div');
        animSection.className = 'sv-section';

        const animHeader = document.createElement('div');
        animHeader.className = 'sv-section-header';
        animHeader.style.gap = '4px';

        const animArrow = document.createElement('span');
        animArrow.className = 'sv-section-arrow';
        animArrow.textContent = '\u25BC';
        animHeader.appendChild(animArrow);

        const animTitle = document.createElement('span');
        animTitle.textContent = 'ANIMATIONS';
        animTitle.style.flex = '1';
        animTitle.style.letterSpacing = '0.5px';
        animHeader.appendChild(animTitle);

        this.animBadge = document.createElement('span');
        this.animBadge.className = 'sv-tree-badge';
        animHeader.appendChild(this.animBadge);

        animSection.appendChild(animHeader);
        animHeader.addEventListener('click', () => animHeader.classList.toggle('collapsed'));

        const animBody = document.createElement('div');
        animBody.className = 'sv-section-body';
        animBody.style.padding = '0';

        // Track selector row
        const trackRow = document.createElement('div');
        trackRow.style.cssText = 'padding:4px 8px 2px;display:flex;flex-wrap:wrap;gap:3px;align-items:center';

        const trackLbl = document.createElement('span');
        trackLbl.style.cssText = 'font-size:var(--sv-font-size-sm);color:var(--sv-text-muted);margin-right:2px';
        trackLbl.textContent = 'Track:';
        trackRow.appendChild(trackLbl);

        for (let i = 0; i < 12; i++) {
            const pill = document.createElement('button');
            pill.className = 'sv-btn sv-btn-sm';
            pill.textContent = String(i);
            pill.style.cssText = 'padding:0 6px;min-width:22px;height:22px;font-size:var(--sv-font-size-sm);font-family:var(--sv-font-mono)';
            const trackIndex = i;
            pill.addEventListener('click', (e) => {
                e.stopPropagation();
                this.currentTrack = trackIndex;
                this.updateTrackPills();
            });
            this.trackPills.push(pill);
            trackRow.appendChild(pill);
        }

        animBody.appendChild(trackRow);

        // Current anim tag
        this.animTag = document.createElement('div');
        this.animTag.style.display = 'none';
        this.animTag.style.padding = '4px 10px';
        this.animTag.style.fontSize = 'var(--sv-font-size-sm)';
        animBody.appendChild(this.animTag);

        this.animList = document.createElement('div');
        this.animList.style.maxHeight = '200px';
        this.animList.style.overflowY = 'auto';
        animBody.appendChild(this.animList);

        animSection.appendChild(animBody);
        this.element.appendChild(animSection);

        // ── SKINS ────────────────────────────────────────────────────
        const skinSection = document.createElement('div');
        skinSection.className = 'sv-section';

        const skinHeader = document.createElement('div');
        skinHeader.className = 'sv-section-header';

        const skinArrow = document.createElement('span');
        skinArrow.className = 'sv-section-arrow';
        skinArrow.textContent = '\u25BC';
        skinHeader.appendChild(skinArrow);

        const skinTitle = document.createElement('span');
        skinTitle.textContent = 'SKINS';
        skinTitle.style.flex = '1';
        skinTitle.style.letterSpacing = '0.5px';
        skinHeader.appendChild(skinTitle);

        this.skinBadge = document.createElement('span');
        this.skinBadge.className = 'sv-tree-badge';
        skinHeader.appendChild(this.skinBadge);

        skinSection.appendChild(skinHeader);
        skinHeader.addEventListener('click', () => skinHeader.classList.toggle('collapsed'));

        const skinBody = document.createElement('div');
        skinBody.className = 'sv-section-body';
        skinBody.style.padding = '0';

        // Combine toggle — off by default (single-select). On = layer multiple skins.
        const combineRow = document.createElement('div');
        combineRow.style.cssText = 'display:flex;align-items:center;gap:6px;padding:5px 10px 3px';
        const combineWrap = document.createElement('label');
        combineWrap.className = 'sv-toggle';
        this.multiSkinToggle = document.createElement('input');
        this.multiSkinToggle.type = 'checkbox';
        this.multiSkinToggle.checked = false;
        const combineTrack = document.createElement('span');
        combineTrack.className = 'sv-toggle-track';
        combineWrap.appendChild(this.multiSkinToggle);
        combineWrap.appendChild(combineTrack);
        combineRow.appendChild(combineWrap);
        const combineLbl = document.createElement('span');
        combineLbl.style.cssText = 'font-size:var(--sv-font-size-sm);color:var(--sv-text-secondary)';
        combineLbl.textContent = 'Combine skins';
        combineRow.appendChild(combineLbl);
        this.multiSkinToggle.addEventListener('change', () => {
            this.multiSkin = this.multiSkinToggle.checked;
            // Leaving combine mode: collapse to a single active skin.
            if (!this.multiSkin && this.currentSkins.size > 1) {
                const keep = [...this.currentSkins][0];
                this.currentSkins.clear();
                if (keep) this.currentSkins.add(keep);
                this.spineManager.setSkins([...this.currentSkins]);
                this.stateManager.updateProjectA({ currentSkin: keep ?? '' });
            }
            this.updateSkinHint();
            this.refresh();
        });
        skinBody.appendChild(combineRow);

        this.skinHint = document.createElement('div');
        this.skinHint.style.cssText = 'font-size:10px;color:var(--sv-text-muted);padding:0 10px 2px';
        skinBody.appendChild(this.skinHint);
        this.updateSkinHint();

        this.skinList = document.createElement('div');
        this.skinList.style.maxHeight = '160px';
        this.skinList.style.overflowY = 'auto';
        skinBody.appendChild(this.skinList);

        skinSection.appendChild(skinBody);
        this.element.appendChild(skinSection);

        // ── PLAYBACK ─────────────────────────────────────────────────
        const playSection = this.makeSection('PLAYBACK', (body) => {
            this.pauseBtn = document.createElement('button');
            this.pauseBtn.className = 'sv-btn sv-btn-primary';
            this.pauseBtn.style.width = '100%';
            this.pauseBtn.style.justifyContent = 'center';
            this.pauseBtn.style.marginBottom = '6px';
            this.pauseBtn.textContent = '\u23F8 Pause';
            this.pauseBtn.addEventListener('click', () => this.togglePause());
            body.appendChild(this.pauseBtn);

            // Loop row
            const loopRow = document.createElement('div');
            loopRow.className = 'sv-control-row';
            const loopLbl = document.createElement('span');
            loopLbl.className = 'sv-control-label';
            loopLbl.textContent = 'Loop';
            loopRow.appendChild(loopLbl);
            const loopWrap = document.createElement('label');
            loopWrap.className = 'sv-toggle';
            this.loopToggle = document.createElement('input');
            this.loopToggle.type = 'checkbox';
            this.loopToggle.checked = false; // Default: play once (matches reference viewers).
            // Live: change loop on the currently playing track without restarting it.
            this.loopToggle.addEventListener('change', () => {
                this.spineManager.setTrackLoop(this.currentTrack, this.loopToggle.checked);
            });
            const loopTrack = document.createElement('span');
            loopTrack.className = 'sv-toggle-track';
            loopWrap.appendChild(this.loopToggle);
            loopWrap.appendChild(loopTrack);
            loopRow.appendChild(loopWrap);
            body.appendChild(loopRow);

            // Speed row
            const speedRow = document.createElement('div');
            speedRow.className = 'sv-control-row';
            const speedLbl = document.createElement('span');
            speedLbl.className = 'sv-control-label';
            speedLbl.textContent = 'Speed';
            speedRow.appendChild(speedLbl);
            this.speedSlider = document.createElement('input');
            this.speedSlider.type = 'range';
            this.speedSlider.className = 'sv-slider';
            this.speedSlider.min = '0';
            this.speedSlider.max = '3';
            this.speedSlider.step = '0.05';
            this.speedSlider.value = '1';
            this.speedSlider.style.flex = '1';
            this.speedSlider.addEventListener('input', () => {
                const speed = parseFloat(this.speedSlider.value);
                this.speedValue.textContent = speed.toFixed(2) + 'x';
                this.spineManager.setSpeed(speed);
                this.stateManager.updateProjectA({ speed });
            });
            speedRow.appendChild(this.speedSlider);
            this.speedValue = document.createElement('span');
            this.speedValue.className = 'sv-control-value';
            this.speedValue.textContent = '1.00x';
            this.speedValue.style.minWidth = '40px';
            speedRow.appendChild(this.speedValue);
            body.appendChild(speedRow);

            // Reset pose
            const resetBtn = document.createElement('button');
            resetBtn.className = 'sv-btn sv-btn-sm';
            resetBtn.style.marginTop = '4px';
            resetBtn.textContent = 'Reset Pose';
            resetBtn.addEventListener('click', () => {
                this.spineManager.resetPose();
                eventBus.emit('pose:reset');
            });
            body.appendChild(resetBtn);
        });
        this.element.appendChild(playSection);

        // ── ANIMATION QUEUE ───────────────────────────────────────────
        const queueSection = this.makeSection('ANIMATION QUEUE', (body) => {
            const btnRow = document.createElement('div');
            btnRow.className = 'sv-control-row';
            btnRow.style.flexWrap = 'wrap';
            btnRow.style.gap = '4px';

            const addBtn = document.createElement('button');
            addBtn.className = 'sv-btn sv-btn-sm';
            addBtn.textContent = '+ Add';
            addBtn.title = 'Add current animation to queue';
            addBtn.addEventListener('click', () => {
                if (this.currentAnim) {
                    this.queue.push(this.currentAnim);
                    this.renderQueue();
                }
            });
            btnRow.appendChild(addBtn);

            const playBtn = document.createElement('button');
            playBtn.className = 'sv-btn sv-btn-sm sv-btn-primary';
            playBtn.textContent = '\u25B6 Play Queue';
            playBtn.addEventListener('click', () => this.playQueue());
            btnRow.appendChild(playBtn);

            const clearBtn = document.createElement('button');
            clearBtn.className = 'sv-btn sv-btn-sm';
            clearBtn.textContent = 'Clear';
            clearBtn.addEventListener('click', () => { this.queue = []; this.renderQueue(); });
            btnRow.appendChild(clearBtn);

            body.appendChild(btnRow);

            this.queueListEl = document.createElement('div');
            this.queueListEl.style.marginTop = '4px';
            body.appendChild(this.queueListEl);
        });
        this.element.appendChild(queueSection);

        // ── EVENT TRIGGERS ────────────────────────────────────────────
        const triggerSection = this.makeSection('EVENT TRIGGERS', (body) => {
            const helpText = document.createElement('div');
            helpText.style.cssText = 'font-size:10px;color:var(--sv-text-muted);padding:0 0 6px';
            helpText.textContent = 'Play an animation when a custom event fires.';
            body.appendChild(helpText);

            const formWrap = document.createElement('div');
            formWrap.style.cssText = 'display:flex;flex-direction:column;gap:4px';

            // Row 1: When event [select]
            const r1 = document.createElement('div');
            r1.className = 'sv-control-row';
            const r1lbl = document.createElement('span');
            r1lbl.className = 'sv-control-label';
            r1lbl.textContent = 'On event';
            r1.appendChild(r1lbl);
            this.triggerEventSelect = document.createElement('select');
            this.triggerEventSelect.className = 'sv-select';
            this.triggerEventSelect.style.flex = '1';
            r1.appendChild(this.triggerEventSelect);
            formWrap.appendChild(r1);

            // Row 2: Play [animation] on track [N]
            const r2 = document.createElement('div');
            r2.className = 'sv-control-row';
            const r2lbl = document.createElement('span');
            r2lbl.className = 'sv-control-label';
            r2lbl.textContent = 'Play';
            r2.appendChild(r2lbl);
            this.triggerAnimSelect = document.createElement('select');
            this.triggerAnimSelect.className = 'sv-select';
            this.triggerAnimSelect.style.flex = '1';
            r2.appendChild(this.triggerAnimSelect);
            const r2t = document.createElement('span');
            r2t.style.cssText = 'font-size:10px;color:var(--sv-text-muted);margin:0 4px';
            r2t.textContent = 'on T';
            r2.appendChild(r2t);
            this.triggerTrackSelect = document.createElement('select');
            this.triggerTrackSelect.className = 'sv-select';
            this.triggerTrackSelect.style.width = '46px';
            for (let i = 0; i < 12; i++) {
                const opt = document.createElement('option');
                opt.value = String(i);
                opt.textContent = String(i);
                this.triggerTrackSelect.appendChild(opt);
            }
            r2.appendChild(this.triggerTrackSelect);
            formWrap.appendChild(r2);

            // Row 3: Loop + Add
            const r3 = document.createElement('div');
            r3.className = 'sv-control-row';
            const loopWrapT = document.createElement('label');
            loopWrapT.className = 'sv-toggle';
            this.triggerLoopToggle = document.createElement('input');
            this.triggerLoopToggle.type = 'checkbox';
            this.triggerLoopToggle.checked = true;
            const loopTrackT = document.createElement('span');
            loopTrackT.className = 'sv-toggle-track';
            loopWrapT.appendChild(this.triggerLoopToggle);
            loopWrapT.appendChild(loopTrackT);
            r3.appendChild(loopWrapT);
            const loopLblT = document.createElement('span');
            loopLblT.style.cssText = 'font-size:10px;color:var(--sv-text-muted);margin-right:auto;margin-left:4px';
            loopLblT.textContent = 'Loop';
            r3.appendChild(loopLblT);
            const addTriggerBtn = document.createElement('button');
            addTriggerBtn.className = 'sv-btn sv-btn-sm sv-btn-primary';
            addTriggerBtn.textContent = '+ Add Trigger';
            addTriggerBtn.addEventListener('click', () => this.addTrigger());
            r3.appendChild(addTriggerBtn);
            formWrap.appendChild(r3);

            body.appendChild(formWrap);

            this.triggerListEl = document.createElement('div');
            this.triggerListEl.style.marginTop = '6px';
            body.appendChild(this.triggerListEl);
        });
        this.element.appendChild(triggerSection);

        // ── VIEW ─────────────────────────────────────────────────────
        const viewSection = this.makeSection('VIEW', (body) => {
            const scaleRow = document.createElement('div');
            scaleRow.className = 'sv-control-row';
            const scaleLbl = document.createElement('span');
            scaleLbl.className = 'sv-control-label';
            scaleLbl.textContent = 'Scale';
            scaleRow.appendChild(scaleLbl);
            // This slider mirrors the viewport zoom (same thing the mouse wheel
            // changes), kept in sync both ways via the 'viewport:zoom'/'viewport:change' events.
            this.scaleSlider = document.createElement('input');
            this.scaleSlider.type = 'range';
            this.scaleSlider.className = 'sv-slider';
            this.scaleSlider.min = '0.05';
            this.scaleSlider.max = '10';
            this.scaleSlider.step = '0.05';
            this.scaleSlider.value = String(this.stateManager.viewport.zoom);
            this.scaleSlider.style.flex = '1';
            this.scaleSlider.addEventListener('input', () => {
                const zoom = parseFloat(this.scaleSlider.value);
                this.scaleValue.textContent = zoom.toFixed(2) + 'x';
                eventBus.emit('viewport:zoom', zoom);
            });
            scaleRow.appendChild(this.scaleSlider);
            this.scaleValue = document.createElement('span');
            this.scaleValue.className = 'sv-control-value';
            this.scaleValue.textContent = this.stateManager.viewport.zoom.toFixed(2) + 'x';
            scaleRow.appendChild(this.scaleValue);
            body.appendChild(scaleRow);

            // Mix (crossfade) duration between animations.
            const mixRow = document.createElement('div');
            mixRow.className = 'sv-control-row';
            const mixLbl = document.createElement('span');
            mixLbl.className = 'sv-control-label';
            mixLbl.textContent = 'Mix';
            mixLbl.title = 'Crossfade duration applied when switching animations';
            mixRow.appendChild(mixLbl);
            const mixSlider = document.createElement('input');
            mixSlider.type = 'range';
            mixSlider.className = 'sv-slider';
            mixSlider.min = '0';
            mixSlider.max = '1';
            mixSlider.step = '0.05';
            mixSlider.value = '0';
            mixSlider.style.flex = '1';
            const mixValue = document.createElement('span');
            mixValue.className = 'sv-control-value';
            mixValue.textContent = '0.00s';
            mixSlider.addEventListener('input', () => {
                this.mixDuration = parseFloat(mixSlider.value);
                mixValue.textContent = this.mixDuration.toFixed(2) + 's';
                this.spineManager.setDefaultMix(this.mixDuration);
            });
            mixRow.appendChild(mixSlider);
            mixRow.appendChild(mixValue);
            body.appendChild(mixRow);

            // Reference / mockup image behind the skeleton.
            const refRow = document.createElement('div');
            refRow.className = 'sv-control-row';
            refRow.style.flexWrap = 'wrap';
            refRow.style.gap = '4px';
            const refBtn = document.createElement('button');
            refBtn.className = 'sv-btn sv-btn-sm';
            refBtn.textContent = '🖼 Reference';
            refBtn.title = 'Load a reference image behind the skeleton';
            refBtn.addEventListener('click', () => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'image/*';
                input.addEventListener('change', () => {
                    const file = input.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => eventBus.emit('reference:image', reader.result as string);
                    reader.readAsDataURL(file);
                });
                input.click();
            });
            refRow.appendChild(refBtn);
            const refClear = document.createElement('button');
            refClear.className = 'sv-btn sv-btn-sm';
            refClear.textContent = '✕';
            refClear.title = 'Remove reference image';
            refClear.addEventListener('click', () => eventBus.emit('reference:image', null));
            refRow.appendChild(refClear);
            const refOpacity = document.createElement('input');
            refOpacity.type = 'range';
            refOpacity.className = 'sv-slider';
            refOpacity.min = '0.05';
            refOpacity.max = '1';
            refOpacity.step = '0.05';
            refOpacity.value = '0.5';
            refOpacity.style.flex = '1';
            refOpacity.title = 'Reference image opacity';
            refOpacity.addEventListener('input', () => eventBus.emit('reference:opacity', parseFloat(refOpacity.value)));
            refRow.appendChild(refOpacity);
            body.appendChild(refRow);
        });
        this.element.appendChild(viewSection);

        // ── DEBUG DRAW ───────────────────────────────────────────────
        const debugSection = this.makeSection('DEBUG DRAW', (body) => {
            const hint = document.createElement('div');
            hint.style.cssText = 'font-size:10px;color:var(--sv-text-muted);padding:0 0 6px';
            hint.textContent = 'Overlay skeleton internals (Spine 4.2).';
            body.appendChild(hint);

            const grid = document.createElement('div');
            grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:2px 8px';

            const options: { key: keyof DebugDrawOptions; label: string }[] = [
                { key: 'bones', label: 'Bones' },
                { key: 'meshes', label: 'Meshes' },
                { key: 'boundingBoxes', label: 'Bounds' },
                { key: 'regions', label: 'Regions' },
                { key: 'clipping', label: 'Clipping' },
                { key: 'paths', label: 'Paths' },
            ];

            options.forEach(({ key, label }) => {
                const row = document.createElement('label');
                row.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;font-size:var(--sv-font-size-sm)';
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.checked = this.debug[key];
                cb.addEventListener('change', () => {
                    this.debug[key] = cb.checked;
                    this.spineManager.setDebugOptions(this.debug);
                });
                row.appendChild(cb);
                const txt = document.createElement('span');
                txt.textContent = label;
                row.appendChild(txt);
                grid.appendChild(row);
            });

            body.appendChild(grid);
        });
        this.element.appendChild(debugSection);

        // ── ONION SKIN ───────────────────────────────────────────────
        const onionSection = this.makeSection('ONION SKIN', (body) => {
            const hint = document.createElement('div');
            hint.style.cssText = 'font-size:10px;color:var(--sv-text-muted);padding:0 0 6px';
            hint.textContent = 'Ghost poses before/after the current frame (timing & spacing). Costs extra draw calls.';
            body.appendChild(hint);

            const cfg = { before: 2, after: 2, step: 3 };

            const enableRow = document.createElement('div');
            enableRow.className = 'sv-control-row';
            const enableLbl = document.createElement('span');
            enableLbl.className = 'sv-control-label';
            enableLbl.textContent = 'Enable';
            enableRow.appendChild(enableLbl);
            const enableWrap = document.createElement('label');
            enableWrap.className = 'sv-toggle';
            const enableToggle = document.createElement('input');
            enableToggle.type = 'checkbox';
            const enableTrack = document.createElement('span');
            enableTrack.className = 'sv-toggle-track';
            enableWrap.appendChild(enableToggle);
            enableWrap.appendChild(enableTrack);
            enableRow.appendChild(enableWrap);
            enableToggle.addEventListener('change', () => eventBus.emit('onion:toggle', enableToggle.checked));
            body.appendChild(enableRow);

            const numRow = (label: string, key: 'before' | 'after' | 'step', min: number, max: number) => {
                const row = document.createElement('div');
                row.className = 'sv-control-row';
                const lbl = document.createElement('span');
                lbl.className = 'sv-control-label';
                lbl.textContent = label;
                row.appendChild(lbl);
                const input = document.createElement('input');
                input.type = 'number';
                input.min = String(min);
                input.max = String(max);
                input.value = String(cfg[key]);
                input.style.cssText = 'width:56px;padding:2px 6px;border:1px solid var(--sv-border);border-radius:var(--sv-radius);background:var(--sv-bg-input);color:var(--sv-text-primary);font-size:var(--sv-font-size-sm)';
                input.addEventListener('change', () => {
                    cfg[key] = Math.max(min, Math.min(max, parseInt(input.value) || min));
                    input.value = String(cfg[key]);
                    eventBus.emit('onion:config', { [key]: cfg[key] });
                });
                row.appendChild(input);
                body.appendChild(row);
            };
            numRow('Before', 'before', 0, 10);
            numRow('After', 'after', 0, 10);
            numRow('Frame step', 'step', 1, 30);
        });
        this.element.appendChild(onionSection);
    }

    private makeSection(title: string, build: (body: HTMLElement) => void): HTMLElement {
        const section = document.createElement('div');
        section.className = 'sv-section';
        const header = document.createElement('div');
        header.className = 'sv-section-header';
        header.innerHTML = `<span class="sv-section-arrow">\u25BC</span><span style="flex:1;letter-spacing:0.5px">${title}</span>`;
        header.addEventListener('click', () => header.classList.toggle('collapsed'));
        section.appendChild(header);
        const body = document.createElement('div');
        body.className = 'sv-section-body';
        build(body);
        section.appendChild(body);
        return section;
    }

    private updateSkinHint(): void {
        this.skinHint.textContent = this.multiSkin
            ? 'Click to toggle — selected skins are combined.'
            : 'Click to select one skin.';
    }

    private updateTrackPills(): void {
        const activeTracks = new Set(this.spineManager.getAllActiveTracks().map(t => t.trackIndex));
        this.trackPills.forEach((pill, i) => {
            const isSelected = i === this.currentTrack;
            const isActive = activeTracks.has(i);
            if (isSelected) {
                pill.style.background = 'var(--sv-accent)';
                pill.style.color = '#fff';
                pill.style.borderColor = 'var(--sv-accent)';
            } else if (isActive) {
                pill.style.background = 'rgba(99,102,241,0.15)';
                pill.style.color = 'var(--sv-accent)';
                pill.style.borderColor = 'var(--sv-accent)';
            } else {
                pill.style.background = '';
                pill.style.color = '';
                pill.style.borderColor = '';
            }
        });
    }

    private togglePause(): void {
        const project = this.stateManager.projectA;
        if (!project) return;
        this.isPaused = !this.isPaused;
        this.spineManager.setPaused(this.isPaused);
        this.stateManager.updateProjectA({ paused: this.isPaused });
        this.pauseBtn.textContent = this.isPaused ? '\u25B6 Resume' : '\u23F8 Pause';
        const btn = document.getElementById('sv-pause-btn');
        if (btn) btn.textContent = this.isPaused ? 'Resume' : 'Pause';
    }

    private toggleLoopCurrent(): void {
        const next = !this.loopToggle.checked;
        this.loopToggle.checked = next;
        this.spineManager.setTrackLoop(this.currentTrack, next);
        eventBus.emit('toast', { message: `Track ${this.currentTrack} loop: ${next ? 'on' : 'off'}` });
    }

    private toggleLoopAll(): void {
        const tracks = this.spineManager.getAllActiveTracks();
        if (tracks.length === 0) return;
        // If every active track is looping, turn them all off; otherwise turn all on.
        const next = !tracks.every(t => t.loop);
        tracks.forEach(t => this.spineManager.setTrackLoop(t.trackIndex, next));
        this.loopToggle.checked = next;
        eventBus.emit('toast', { message: `All tracks loop: ${next ? 'on' : 'off'}` });
    }

    private playQueue(): void {
        if (this.queue.length === 0) return;
        this.spineManager.setAnimationsList(this.currentTrack, [...this.queue], this.loopToggle.checked);
    }

    private renderQueue(): void {
        this.queueListEl.innerHTML = '';
        this.queue.forEach((name, idx) => {
            const item = document.createElement('div');
            item.style.cssText = 'display:flex;align-items:center;gap:4px;padding:2px 0;font-size:var(--sv-font-size-sm)';
            const lbl = document.createElement('span');
            lbl.style.flex = '1';
            lbl.textContent = `${idx + 1}. ${name}`;
            item.appendChild(lbl);
            const rm = document.createElement('button');
            rm.className = 'sv-btn sv-btn-sm';
            rm.textContent = '\u00D7';
            rm.addEventListener('click', () => { this.queue.splice(idx, 1); this.renderQueue(); });
            item.appendChild(rm);
            this.queueListEl.appendChild(item);
        });
    }

    private addTrigger(): void {
        const eventName = this.triggerEventSelect.value;
        const animationName = this.triggerAnimSelect.value;
        if (!eventName || !animationName) return;
        const trigger: EventTrigger = {
            id: ++this.triggerIdCounter,
            eventName,
            trackIndex: parseInt(this.triggerTrackSelect.value),
            animationName,
            loop: this.triggerLoopToggle.checked,
        };
        this.triggers.push(trigger);
        this.renderTriggers();
    }

    private renderTriggers(): void {
        this.triggerListEl.innerHTML = '';
        if (this.triggers.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText = 'font-size:10px;color:var(--sv-text-muted)';
            empty.textContent = 'No triggers defined';
            this.triggerListEl.appendChild(empty);
            return;
        }
        this.triggers.forEach(t => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:4px;padding:3px 0;border-bottom:1px solid var(--sv-border-light);font-size:var(--sv-font-size-sm)';

            const badge = document.createElement('span');
            badge.className = 'sv-tree-badge';
            badge.textContent = t.eventName;
            badge.style.background = 'rgba(154,74,181,0.15)';
            badge.style.color = '#9a4ab5';
            row.appendChild(badge);

            const arrow = document.createElement('span');
            arrow.style.color = 'var(--sv-text-muted)';
            arrow.textContent = '\u2192';
            row.appendChild(arrow);

            const info = document.createElement('span');
            info.style.flex = '1';
            info.style.overflow = 'hidden';
            info.style.textOverflow = 'ellipsis';
            info.style.whiteSpace = 'nowrap';
            info.textContent = `${t.animationName} T${t.trackIndex}${t.loop ? ' \u221E' : ''}`;
            row.appendChild(info);

            const rm = document.createElement('button');
            rm.className = 'sv-btn sv-btn-sm';
            rm.textContent = '\u00D7';
            rm.addEventListener('click', () => {
                this.triggers = this.triggers.filter(x => x.id !== t.id);
                this.renderTriggers();
            });
            row.appendChild(rm);

            this.triggerListEl.appendChild(row);
        });
    }

    private renderItem(container: HTMLElement, name: string, isActive: boolean, onSelect: () => void, cost?: AnimationCost): void {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.padding = '5px 10px';
        row.style.gap = '8px';
        row.style.cursor = 'pointer';
        row.style.background = isActive ? 'var(--sv-accent)' : 'transparent';
        row.style.color = isActive ? '#fff' : 'var(--sv-text-primary)';
        row.style.fontSize = 'var(--sv-font-size)';

        // Cost severity pip (animations only) — immediate "which ones are heavy".
        if (cost) {
            const pip = document.createElement('span');
            const color = SEVERITY_COLOR[cost.severity];
            const hollow = cost.severity === 'ok';
            pip.style.cssText = `width:8px;height:8px;border-radius:2px;flex-shrink:0;border:1px solid ${color};background:${hollow ? 'transparent' : color}`;
            const lines = cost.drivers.length
                ? cost.drivers.map(d => `• ${d.label}`).join('\n')
                : 'No notable cost drivers';
            pip.title = `${cost.severity.toUpperCase()} (cost ${cost.score})\n${lines}`;
            row.appendChild(pip);
        }

        const dot = document.createElement('span');
        dot.style.cssText = `width:7px;height:7px;border-radius:50%;flex-shrink:0;border:1px solid ${isActive ? 'rgba(255,255,255,0.7)' : 'var(--sv-text-muted)'};background:${isActive ? 'rgba(255,255,255,0.9)' : 'transparent'}`;
        row.appendChild(dot);

        const nameEl = document.createElement('span');
        nameEl.style.flex = '1';
        nameEl.style.overflow = 'hidden';
        nameEl.style.textOverflow = 'ellipsis';
        nameEl.style.whiteSpace = 'nowrap';
        nameEl.title = name;
        nameEl.textContent = name;
        row.appendChild(nameEl);

        const copyBtn = document.createElement('button');
        copyBtn.className = 'sv-btn sv-btn-sm';
        copyBtn.style.cssText = 'padding:0 5px;min-width:22px;opacity:0;font-size:var(--sv-font-size-sm);flex-shrink:0';
        if (isActive) { copyBtn.style.background = 'rgba(255,255,255,0.2)'; copyBtn.style.border = '1px solid rgba(255,255,255,0.3)'; copyBtn.style.color = '#fff'; }
        copyBtn.textContent = '\u2398';
        copyBtn.title = 'Copy name';
        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(name).catch(() => {});
            copyBtn.textContent = '\u2713';
            setTimeout(() => { copyBtn.textContent = '\u2398'; }, 1000);
        });
        row.appendChild(copyBtn);

        row.addEventListener('mouseenter', () => { copyBtn.style.opacity = '1'; if (!isActive) row.style.background = 'var(--sv-bg-hover)'; });
        row.addEventListener('mouseleave', () => { copyBtn.style.opacity = '0'; if (!isActive) row.style.background = 'transparent'; });
        row.addEventListener('click', onSelect);
        container.appendChild(row);
    }

    refresh(): void {
        const project = this.stateManager.projectA;
        this.animList.innerHTML = '';
        this.skinList.innerHTML = '';

        if (!project) {
            this.animBadge.textContent = '';
            this.skinBadge.textContent = '';
            this.animTag.style.display = 'none';
            return;
        }

        // Static cost profile → severity pips next to each animation.
        this.animCosts.clear();
        this.spineManager.profile()?.animations.forEach(a => this.animCosts.set(a.name, a));

        this.animBadge.textContent = String(project.animationNames.length);
        this.skinBadge.textContent = this.currentSkins.size > 1
            ? `${this.currentSkins.size}/${project.skinNames.length}`
            : String(project.skinNames.length);

        if (!this.currentAnim && project.animationNames.length > 0) {
            this.currentAnim = project.animationNames[0];
        }
        if (this.currentSkins.size === 0) {
            const initial = project.currentSkin || project.skinNames[0];
            if (initial) this.currentSkins.add(initial);
        }

        // Populate trigger selects
        this.triggerEventSelect.innerHTML = '';
        project.eventNames.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            this.triggerEventSelect.appendChild(opt);
        });

        this.triggerAnimSelect.innerHTML = '';
        project.animationNames.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            this.triggerAnimSelect.appendChild(opt);
        });

        this.renderTriggers();

        // Active tag chip
        if (this.currentAnim) {
            this.animTag.style.display = 'block';
            this.animTag.innerHTML = '';
            const chip = document.createElement('span');
            chip.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:1px 8px;border-radius:10px;background:var(--sv-accent);color:#fff;font-size:var(--sv-font-size-sm)';
            const trackBadge = document.createElement('strong');
            trackBadge.textContent = `T${this.currentTrack}`;
            chip.appendChild(trackBadge);
            const sep = document.createTextNode('\u00A0');
            chip.appendChild(sep);
            const animName = document.createElement('span');
            animName.textContent = this.currentAnim;
            chip.appendChild(animName);
            const dismiss = document.createElement('span');
            dismiss.textContent = '\u00D7';
            dismiss.style.cssText = 'cursor:pointer;margin-left:4px;opacity:0.7';
            dismiss.addEventListener('click', () => {
                this.spineManager.clearTrack(this.currentTrack);
                this.currentAnim = '';
                this.refresh();
            });
            chip.appendChild(dismiss);
            this.animTag.appendChild(chip);
        } else {
            this.animTag.style.display = 'none';
        }

        project.animationNames.forEach(name => {
            this.renderItem(this.animList, name, name === this.currentAnim, () => {
                this.currentAnim = name;
                const loop = this.loopToggle.checked;
                this.spineManager.setAnimation(this.currentTrack, name, loop);
                this.stateManager.updateProjectA({ currentTrack: this.currentTrack });
                if (this.isPaused) {
                    this.isPaused = false;
                    this.spineManager.setPaused(false);
                    this.pauseBtn.textContent = '\u23F8 Pause';
                }
                this.refresh();
            }, this.animCosts.get(name));
        });

        project.skinNames.forEach(name => {
            this.renderItem(this.skinList, name, this.currentSkins.has(name), () => {
                if (this.multiSkin) {
                    // Combine mode: toggle membership — selected skins layer into one.
                    if (this.currentSkins.has(name)) {
                        this.currentSkins.delete(name);
                    } else {
                        this.currentSkins.add(name);
                    }
                } else {
                    // Single-select: clicking the active skin clears it, otherwise replaces.
                    const wasOnly = this.currentSkins.has(name) && this.currentSkins.size === 1;
                    this.currentSkins.clear();
                    if (!wasOnly) this.currentSkins.add(name);
                }
                const names = [...this.currentSkins];
                this.spineManager.setSkins(names);
                this.stateManager.updateProjectA({ currentSkin: names[0] ?? '' });
                this.refresh();
            });
        });

        this.updateTrackPills();
    }
}
