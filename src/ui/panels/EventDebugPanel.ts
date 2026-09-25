import { eventBus } from '../../core/EventBus';
import type { SpineEventData, SpineManager } from '../../core/SpineManager';
import type { StateManager } from '../../core/StateManager';
import type { EventKey } from '../../services/EventKeys';

const KEY_FPS = 30;

interface CompareProjectRef {
    name: string;
}

/** Event toasts kept on the canvas at once (oldest dropped first). */
const MAX_CANVAS_TOASTS = 4;

export class EventDebugPanel {
    element: HTMLElement;
    private typeFilters: Map<string, boolean> = new Map();
    private nameFilters: Map<string, boolean> = new Map();
    private nameFilterEl!: HTMLElement;
    private toastContainer: HTMLElement | null = null;

    private compareProjects: CompareProjectRef[] = [];
    private selectedProjects: Set<string> = new Set();
    private isCompareMode = false;
    private projectFilterEl!: HTMLElement;

    // Event keys table
    private keysBody!: HTMLElement;
    private keysSummary!: HTMLElement;
    private keysScope: 'playing' | 'all' = 'playing';
    private keysSearch = '';
    private playingSignature = '';
    private scopeBtns = new Map<'playing' | 'all', HTMLButtonElement>();

    constructor(
        private spineManager: SpineManager,
        private stateManager: StateManager,
    ) {
        this.element = document.createElement('div');
        this.element.style.display = 'flex';
        this.element.style.flexDirection = 'column';
        this.element.style.padding = '8px 0';
        this.buildKeysTable();
        this.build();

        eventBus.on('spine:event', (data: SpineEventData) => {
            this.flashKey(data);
            this.onSpineEvent(data);
        });
        eventBus.on('project:change', () => {
            this.nameFilters.clear();
            this.renderNameFilters();
            this.renderKeys();
        });
        // "Playing" scope follows the active tracks; cheap poll, only while visible.
        setInterval(() => {
            if (this.keysScope !== 'playing' || !this.element.offsetParent) return;
            if (this.playingAnimations().join('|') !== this.playingSignature) this.renderKeys();
        }, 300);
        eventBus.on('mode:change', (mode: string) => {
            this.isCompareMode = mode === 'comparison';
            this.projectFilterEl.style.display = this.isCompareMode ? 'block' : 'none';
        });
        eventBus.on('comparison:projects-changed', (projects: CompareProjectRef[]) => {
            this.compareProjects = projects;
            // Add any new projects to selected set by default
            projects.forEach(p => this.selectedProjects.add(p.name));
            this.renderProjectFilters();
        });
    }

    // ── Event keys table ─────────────────────────────────────────────

    private buildKeysTable(): void {
        const header = document.createElement('div');
        header.className = 'sv-evkeys-header';
        const title = document.createElement('span');
        title.className = 'sv-evkeys-title';
        title.textContent = 'EVENT KEYS';
        header.appendChild(title);

        const seg = document.createElement('div');
        seg.className = 'sv-segmented';
        (['playing', 'all'] as const).forEach(scope => {
            const b = document.createElement('button');
            b.textContent = scope === 'playing' ? 'Playing' : 'All';
            b.title = scope === 'playing' ? 'Only animations on active tracks' : 'Every animation in the skeleton';
            b.classList.toggle('active', scope === this.keysScope);
            b.addEventListener('click', () => {
                this.keysScope = scope;
                this.scopeBtns.forEach((btn, k) => btn.classList.toggle('active', k === scope));
                this.renderKeys();
            });
            this.scopeBtns.set(scope, b);
            seg.appendChild(b);
        });
        header.appendChild(seg);
        this.element.appendChild(header);

        const search = document.createElement('input');
        search.className = 'sv-tree-search sv-evkeys-search';
        search.placeholder = 'Filter by event or animation...';
        search.addEventListener('input', () => {
            this.keysSearch = search.value.trim().toLowerCase();
            this.renderKeys();
        });
        this.element.appendChild(search);

        this.keysSummary = document.createElement('div');
        this.keysSummary.className = 'sv-evkeys-summary';
        this.element.appendChild(this.keysSummary);

        this.keysBody = document.createElement('div');
        this.keysBody.className = 'sv-evkeys';
        this.element.appendChild(this.keysBody);

        this.renderKeys();
    }

    private playingAnimations(): string[] {
        return this.spineManager.getAllActiveTracks().map(t => t.name);
    }

    private renderKeys(): void {
        const body = this.keysBody;
        body.innerHTML = '';
        this.playingSignature = this.playingAnimations().join('|');
        const empty = (text: string) => {
            const el = document.createElement('div');
            el.className = 'sv-evkeys-empty';
            el.textContent = text;
            body.appendChild(el);
        };

        if (!this.spineManager.spine) {
            this.keysSummary.textContent = '';
            empty('Load a skeleton to see its event keys.');
            return;
        }

        const all = this.spineManager.getAllEventKeys();
        let totalKeys = 0;
        let animsWithKeys = 0;
        all.forEach(keys => {
            totalKeys += keys.length;
            if (keys.length) animsWithKeys++;
        });
        const types = this.spineManager.getEventNames().length;
        this.keysSummary.textContent = `${types} event type${types === 1 ? '' : 's'} · ${totalKeys} key${totalKeys === 1 ? '' : 's'} in ${animsWithKeys} animation${animsWithKeys === 1 ? '' : 's'} · click a row to jump there`;

        if (totalKeys === 0) {
            empty('This skeleton has no event keys.');
            return;
        }

        let names: string[];
        if (this.keysScope === 'playing') {
            names = [...new Set(this.playingAnimations())];
            if (names.length === 0) {
                empty('Nothing is playing — pick an animation, or switch to All.');
                return;
            }
        } else {
            names = [...all.keys()];
        }

        const q = this.keysSearch;
        let shown = 0;
        for (const anim of names) {
            const keys = (all.get(anim) ?? []).filter(k =>
                !q || k.name.toLowerCase().includes(q) || anim.toLowerCase().includes(q));
            // In "Playing" scope still list event-less animations, so it's clear they were checked.
            if (keys.length === 0 && (this.keysScope === 'all' || q)) continue;

            const group = document.createElement('div');
            group.className = 'sv-evkeys-group';
            const gName = document.createElement('span');
            gName.textContent = anim;
            const gCount = document.createElement('span');
            gCount.className = 'sv-evkeys-count';
            gCount.textContent = keys.length ? String(keys.length) : 'no events';
            group.append(gName, gCount);
            body.appendChild(group);

            for (const k of keys) {
                body.appendChild(this.buildKeyRow(anim, k));
                shown++;
            }
        }
        if (shown === 0 && q) empty('No event keys match the filter.');
    }

    private buildKeyRow(anim: string, k: EventKey): HTMLElement {
        const row = document.createElement('div');
        row.className = 'sv-evkeys-row';
        row.dataset.anim = anim;
        row.dataset.name = k.name;
        row.dataset.time = String(k.time);

        const frameNo = Math.round(k.time * KEY_FPS);
        const ms = document.createElement('span');
        ms.className = 'sv-evkeys-time';
        ms.textContent = String(Math.round(k.time * 1000));
        ms.title = `${k.time.toFixed(3)} s · frame ${frameNo} @${KEY_FPS}fps`;

        const frame = document.createElement('span');
        frame.className = 'sv-evkeys-frame';
        frame.textContent = `f${frameNo}`;

        const name = document.createElement('span');
        name.className = 'sv-evkeys-name';
        name.textContent = k.name;

        const vals: string[] = [];
        if (k.int) vals.push(`i:${k.int}`);
        if (k.float) vals.push(`f:${+k.float.toFixed(3)}`);
        if (k.string) vals.push(`"${k.string}"`);
        if (k.audio) vals.push(`♪ ${k.audio}`);
        const val = document.createElement('span');
        val.className = 'sv-evkeys-values';
        val.textContent = vals.join(' ');
        val.title = vals.join('  ');

        row.append(ms, frame, name, val);
        row.title = `Jump to ${k.name} in ${anim}`;
        row.addEventListener('click', () => this.jumpTo(anim, k.time));
        return row;
    }

    /** Seek (paused) to an event key: reuse a track already playing the animation, else start it. */
    private jumpTo(anim: string, time: number): void {
        let track = this.spineManager.getAllActiveTracks().find(t => t.name === anim)?.trackIndex;
        if (track === undefined) {
            track = this.stateManager.projectA?.currentTrack ?? 0;
            this.spineManager.setAnimation(track, anim, false);
        }
        this.spineManager.seekToPaused(track, time);
        this.stateManager.updateProjectA({ paused: true });
        eventBus.emit('playback:paused-changed', true);
    }

    private flashKey(data: SpineEventData): void {
        if (data.type !== 'event' || !this.element.offsetParent) return;
        this.keysBody.querySelectorAll<HTMLElement>('.sv-evkeys-row').forEach(row => {
            if (row.dataset.anim !== data.animationName || row.dataset.name !== data.eventName) return;
            if (data.eventTime !== undefined && Math.abs(Number(row.dataset.time) - data.eventTime) > 0.001) return;
            row.classList.remove('sv-evkeys-flash');
            void row.offsetWidth; // restart the CSS animation
            row.classList.add('sv-evkeys-flash');
        });
    }

    // ── Canvas notifications ─────────────────────────────────────────

    private build(): void {
        const notifHeader = document.createElement('div');
        notifHeader.className = 'sv-evkeys-header';
        notifHeader.style.marginTop = '14px';
        notifHeader.innerHTML = '<span class="sv-evkeys-title">CANVAS NOTIFICATIONS</span>';
        this.element.appendChild(notifHeader);

        const intro = document.createElement('div');
        intro.style.cssText = 'font-size:10px;color:var(--sv-text-muted);padding:0 0 8px;line-height:1.5';
        intro.innerHTML = 'Toggle event types to show them as on-canvas notifications.<br><strong>Note:</strong> <em>start</em> fires once per animation start — re-select an animation after enabling to test it. <em>complete</em> fires every loop cycle.';
        this.element.appendChild(intro);

        // ── Lifecycle event type toggles ──
        const lifeCycleLabel = document.createElement('div');
        lifeCycleLabel.style.cssText = 'font-size:10px;color:var(--sv-text-muted);font-weight:600;letter-spacing:0.4px;padding:0 0 4px';
        lifeCycleLabel.textContent = 'LIFECYCLE EVENTS';
        this.element.appendChild(lifeCycleLabel);

        const typeRow = document.createElement('div');
        typeRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;padding-bottom:12px';

        const lifecycleTypes = ['start', 'complete', 'end', 'interrupt', 'dispose'];
        const colors: Record<string, string> = {
            start: '#4a9a5a', complete: '#4a7fb5', end: '#808080',
            interrupt: '#c08a30', dispose: '#c05050', event: '#9a4ab5',
        };

        lifecycleTypes.forEach(type => {
            // Default OFF for lifecycle events
            this.typeFilters.set(type, false);
            const btn = document.createElement('button');
            btn.className = 'sv-btn sv-btn-sm';
            btn.textContent = type;
            btn.style.cssText = `border-left-width:3px;border-left-color:${colors[type]};font-size:10px;padding:1px 6px;opacity:0.35`;
            btn.addEventListener('click', () => {
                const enabled = !this.typeFilters.get(type);
                this.typeFilters.set(type, enabled);
                btn.style.opacity = enabled ? '1' : '0.35';
            });
            typeRow.appendChild(btn);
        });

        this.element.appendChild(typeRow);

        // ── Custom events section ──
        const customLabel = document.createElement('div');
        customLabel.style.cssText = 'font-size:10px;color:var(--sv-text-muted);font-weight:600;letter-spacing:0.4px;padding:0 0 4px';
        customLabel.textContent = 'CUSTOM EVENTS';
        this.element.appendChild(customLabel);

        // Default ON for custom event type
        this.typeFilters.set('event', true);

        const customTypeRow = document.createElement('div');
        customTypeRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;padding-bottom:8px';
        const eventTypeBtn = document.createElement('button');
        eventTypeBtn.className = 'sv-btn sv-btn-sm';
        eventTypeBtn.textContent = 'event';
        eventTypeBtn.style.cssText = `border-left-width:3px;border-left-color:${colors['event']};font-size:10px;padding:1px 6px`;
        eventTypeBtn.addEventListener('click', () => {
            const enabled = !this.typeFilters.get('event');
            this.typeFilters.set('event', enabled);
            eventTypeBtn.style.opacity = enabled ? '1' : '0.35';
        });
        customTypeRow.appendChild(eventTypeBtn);
        this.element.appendChild(customTypeRow);

        const nameLbl = document.createElement('div');
        nameLbl.style.cssText = 'font-size:10px;color:var(--sv-text-muted);padding:0 0 4px';
        nameLbl.textContent = 'Per-event filters (auto-populated on first trigger):';
        this.element.appendChild(nameLbl);

        this.nameFilterEl = document.createElement('div');
        this.nameFilterEl.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px';
        this.element.appendChild(this.nameFilterEl);
        this.renderNameFilters();

        // ── Compare mode project filters (hidden in single mode) ──
        this.projectFilterEl = document.createElement('div');
        this.projectFilterEl.style.display = 'none';
        this.projectFilterEl.style.paddingTop = '12px';

        const projectFilterLabel = document.createElement('div');
        projectFilterLabel.style.cssText = 'font-size:10px;color:var(--sv-text-muted);font-weight:600;letter-spacing:0.4px;padding:0 0 4px';
        projectFilterLabel.textContent = 'PROJECT FILTER';
        this.projectFilterEl.appendChild(projectFilterLabel);

        const projectFilterBtns = document.createElement('div');
        projectFilterBtns.className = 'sv-project-filter-btns';
        projectFilterBtns.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px';
        this.projectFilterEl.appendChild(projectFilterBtns);
        this.element.appendChild(this.projectFilterEl);
    }

    private renderProjectFilters(): void {
        const btnsEl = this.projectFilterEl.querySelector('.sv-project-filter-btns') as HTMLElement;
        if (!btnsEl) return;
        btnsEl.innerHTML = '';

        if (this.compareProjects.length === 0) {
            const empty = document.createElement('span');
            empty.style.cssText = 'font-size:10px;color:var(--sv-text-muted)';
            empty.textContent = 'No comparison projects loaded';
            btnsEl.appendChild(empty);
            return;
        }

        this.compareProjects.forEach(p => {
            const enabled = this.selectedProjects.has(p.name);
            const btn = document.createElement('button');
            btn.className = 'sv-btn sv-btn-sm';
            btn.textContent = p.name;
            btn.style.cssText = 'font-size:10px;padding:1px 6px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
            btn.style.opacity = enabled ? '1' : '0.35';
            btn.title = p.name;
            btn.addEventListener('click', () => {
                if (this.selectedProjects.has(p.name)) {
                    this.selectedProjects.delete(p.name);
                    btn.style.opacity = '0.35';
                } else {
                    this.selectedProjects.add(p.name);
                    btn.style.opacity = '1';
                }
            });
            btnsEl.appendChild(btn);
        });
    }

    private renderNameFilters(): void {
        this.nameFilterEl.innerHTML = '';
        if (this.nameFilters.size === 0) {
            const empty = document.createElement('span');
            empty.style.cssText = 'font-size:10px;color:var(--sv-text-muted)';
            empty.textContent = 'none yet \u2014 play an animation with custom events';
            this.nameFilterEl.appendChild(empty);
            return;
        }
        this.nameFilters.forEach((enabled, name) => {
            const btn = document.createElement('button');
            btn.className = 'sv-btn sv-btn-sm';
            btn.textContent = name;
            btn.style.cssText = 'font-size:10px;padding:1px 6px;background:rgba(154,74,181,0.1);border-color:#9a4ab5';
            btn.style.opacity = enabled ? '1' : '0.35';
            btn.addEventListener('click', () => {
                const next = !this.nameFilters.get(name);
                this.nameFilters.set(name, next);
                btn.style.opacity = next ? '1' : '0.35';
            });
            this.nameFilterEl.appendChild(btn);
        });
    }

    private onSpineEvent(data: SpineEventData): void {
        // In compare mode, filter by selected projects
        if (this.isCompareMode && data.projectName && !this.selectedProjects.has(data.projectName)) return;

        // Register custom event names
        if (data.type === 'event' && data.eventName) {
            if (!this.nameFilters.has(data.eventName)) {
                this.nameFilters.set(data.eventName, true);
                this.renderNameFilters();
            }
            if (this.nameFilters.get(data.eventName) === false) return;
        }

        if (!this.typeFilters.get(data.type)) return;

        const label = data.type === 'event' && data.eventName
            ? `\u2605 ${data.eventName}`
            : `${data.type}${data.animationName ? ': ' + data.animationName : ''}`;

        const colors: Record<string, string> = {
            start: 'rgba(74,154,90,0.85)', complete: 'rgba(74,127,181,0.85)',
            end: 'rgba(100,100,100,0.8)', interrupt: 'rgba(192,138,48,0.85)',
            dispose: 'rgba(192,80,80,0.85)', event: 'rgba(154,74,181,0.85)',
        };

        const trackBadge = `T${data.trackIndex}`;
        const projectBadge = this.isCompareMode && data.projectName ? data.projectName : undefined;
        this.showCanvasToast(label, colors[data.type] ?? 'rgba(60,60,60,0.85)', trackBadge, projectBadge);
    }

    private showCanvasToast(text: string, bg: string, badge?: string, projectBadge?: string): void {
        const viewport = document.querySelector('.sv-viewport');
        if (!viewport) return;

        if (!this.toastContainer) {
            this.toastContainer = document.createElement('div');
            this.toastContainer.className = 'sv-canvas-toasts';
            viewport.appendChild(this.toastContainer);
        }

        const toast = document.createElement('div');
        toast.className = 'sv-canvas-toast';
        toast.style.background = bg;

        if (projectBadge) {
            const pb = document.createElement('span');
            pb.className = 'sv-canvas-toast-project';
            pb.textContent = projectBadge;
            toast.appendChild(pb);
        }
        if (badge) {
            const b = document.createElement('span');
            b.className = 'sv-canvas-toast-badge';
            b.textContent = badge;
            toast.appendChild(b);
        }
        const t = document.createElement('span');
        t.textContent = text;
        toast.appendChild(t);

        this.toastContainer.appendChild(toast);
        // Cap the stack so a burst of events never climbs over the art.
        while (this.toastContainer.childElementCount > MAX_CANVAS_TOASTS) {
            this.toastContainer.firstElementChild?.remove();
        }
        setTimeout(() => {
            toast.style.transition = 'opacity 0.3s';
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 1800);
    }
}
