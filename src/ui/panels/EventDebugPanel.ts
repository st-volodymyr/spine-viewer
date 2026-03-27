import { eventBus } from '../../core/EventBus';
import type { SpineEventData } from '../../core/SpineManager';

interface CompareProjectRef {
    name: string;
}

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

    constructor() {
        this.element = document.createElement('div');
        this.element.style.display = 'flex';
        this.element.style.flexDirection = 'column';
        this.element.style.padding = '8px 0';
        this.build();

        eventBus.on('spine:event', (data: SpineEventData) => this.onSpineEvent(data));
        eventBus.on('project:change', () => { this.nameFilters.clear(); this.renderNameFilters(); });
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

    private build(): void {
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
            this.toastContainer.style.cssText = 'position:absolute;bottom:8px;left:50%;transform:translateX(-50%);z-index:200;display:flex;flex-direction:column;align-items:center;gap:4px;pointer-events:none';
            viewport.appendChild(this.toastContainer);
        }

        const toast = document.createElement('div');
        toast.style.cssText = `display:flex;align-items:center;gap:6px;padding:3px 12px;border-radius:12px;background:${bg};color:#fff;font-size:12px;font-family:monospace;white-space:nowrap`;

        if (projectBadge) {
            const pb = document.createElement('span');
            pb.style.cssText = 'font-size:10px;opacity:0.8;max-width:80px;overflow:hidden;text-overflow:ellipsis;border-right:1px solid rgba(255,255,255,0.4);padding-right:6px';
            pb.textContent = projectBadge;
            toast.appendChild(pb);
        }
        if (badge) {
            const b = document.createElement('span');
            b.style.cssText = 'font-size:10px;opacity:0.7';
            b.textContent = badge;
            toast.appendChild(b);
        }
        const t = document.createElement('span');
        t.textContent = text;
        toast.appendChild(t);

        this.toastContainer.appendChild(toast);
        setTimeout(() => {
            toast.style.transition = 'opacity 0.3s';
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 1800);
    }
}
