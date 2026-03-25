import { eventBus } from '../../core/EventBus';
import type { SpineEventData } from '../../core/SpineManager';

export class EventDebugPanel {
    element: HTMLElement;
    private logEl!: HTMLElement;
    private filters: Map<string, boolean> = new Map();
    private maxEntries = 200;

    constructor() {
        this.element = document.createElement('div');
        this.element.style.display = 'flex';
        this.element.style.flexDirection = 'column';
        this.element.style.height = '100%';
        this.build();

        eventBus.on('spine:event', (data: SpineEventData) => this.onSpineEvent(data));
    }

    private build(): void {
        // Filter toggles
        const filterRow = document.createElement('div');
        filterRow.style.display = 'flex';
        filterRow.style.flexWrap = 'wrap';
        filterRow.style.gap = '4px';
        filterRow.style.padding = '4px 0';
        filterRow.style.borderBottom = '1px solid var(--sv-border)';
        filterRow.style.flexShrink = '0';

        const types = ['start', 'complete', 'end', 'interrupt', 'dispose', 'event'];
        const colors: Record<string, string> = {
            start: '#4a9a5a',
            complete: '#4a7fb5',
            end: '#808080',
            interrupt: '#c08a30',
            dispose: '#c05050',
            event: '#9a4ab5',
        };

        types.forEach(type => {
            this.filters.set(type, true);
            const btn = document.createElement('button');
            btn.className = 'sv-btn sv-btn-sm';
            btn.textContent = type;
            btn.style.borderLeftWidth = '3px';
            btn.style.borderLeftColor = colors[type];
            btn.style.fontSize = '10px';
            btn.style.padding = '1px 6px';
            btn.addEventListener('click', () => {
                const enabled = !this.filters.get(type);
                this.filters.set(type, enabled);
                btn.style.opacity = enabled ? '1' : '0.4';
            });
            filterRow.appendChild(btn);
        });

        // Clear button
        const clearBtn = document.createElement('button');
        clearBtn.className = 'sv-btn sv-btn-sm';
        clearBtn.textContent = 'Clear';
        clearBtn.style.marginLeft = 'auto';
        clearBtn.style.fontSize = '10px';
        clearBtn.style.padding = '1px 6px';
        clearBtn.addEventListener('click', () => {
            this.logEl.innerHTML = '';
        });
        filterRow.appendChild(clearBtn);

        this.element.appendChild(filterRow);

        // Event log
        this.logEl = document.createElement('div');
        this.logEl.style.flex = '1';
        this.logEl.style.overflow = 'auto';
        this.logEl.style.fontFamily = 'var(--sv-font-mono)';
        this.logEl.style.fontSize = '11px';
        this.logEl.style.lineHeight = '1.4';
        this.element.appendChild(this.logEl);
    }

    private onSpineEvent(data: SpineEventData): void {
        if (!this.filters.get(data.type)) return;

        // Limit entries
        while (this.logEl.children.length >= this.maxEntries) {
            this.logEl.removeChild(this.logEl.firstChild!);
        }

        const colors: Record<string, string> = {
            start: '#4a9a5a',
            complete: '#4a7fb5',
            end: '#808080',
            interrupt: '#c08a30',
            dispose: '#c05050',
            event: '#9a4ab5',
        };

        const entry = document.createElement('div');
        entry.style.padding = '1px 4px';
        entry.style.borderBottom = '1px solid var(--sv-border-light)';

        const typeSpan = document.createElement('span');
        typeSpan.textContent = data.type.padEnd(10);
        typeSpan.style.color = colors[data.type] ?? 'inherit';
        typeSpan.style.fontWeight = '600';
        entry.appendChild(typeSpan);

        const trackSpan = document.createElement('span');
        trackSpan.textContent = `T${data.trackIndex} `;
        trackSpan.style.color = 'var(--sv-text-muted)';
        entry.appendChild(trackSpan);

        const nameSpan = document.createElement('span');
        nameSpan.textContent = data.animationName;
        entry.appendChild(nameSpan);

        if (data.eventName) {
            const eventSpan = document.createElement('span');
            eventSpan.textContent = ` [${data.eventName}]`;
            eventSpan.style.color = '#9a4ab5';
            entry.appendChild(eventSpan);
        }

        const timeSpan = document.createElement('span');
        timeSpan.textContent = ` ${data.time.toFixed(3)}s`;
        timeSpan.style.color = 'var(--sv-text-muted)';
        timeSpan.style.marginLeft = 'auto';
        entry.appendChild(timeSpan);

        this.logEl.appendChild(entry);
        this.logEl.scrollTop = this.logEl.scrollHeight;
    }
}
