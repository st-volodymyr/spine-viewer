import { eventBus } from './EventBus';
import type { AppState, SpineProjectState, ViewportState } from '../types/state';

/** Default canvas colour per UI theme; the canvas follows the theme until the user picks a colour. */
export const CANVAS_BG = { light: '#c8c8c8', dark: '#2b2b2b' } as const;

export function savedTheme(): 'light' | 'dark' {
    try {
        return localStorage.getItem('sv-theme') === 'dark' ? 'dark' : 'light';
    } catch {
        return 'light';
    }
}

export class StateManager {
    private state: AppState = {
        projectA: null,
        projectB: null,
        viewport: {
            zoom: 1,
            panX: 0,
            panY: 0,
            bgColor: CANVAS_BG[savedTheme()],
            showGrid: true,
        },
        mode: 'single',
        activeInspectorTab: 'animation',
    };

    get projectA(): SpineProjectState | null { return this.state.projectA; }
    get projectB(): SpineProjectState | null { return this.state.projectB; }
    get viewport(): ViewportState { return this.state.viewport; }
    get mode(): 'single' | 'comparison' { return this.state.mode; }
    get activeInspectorTab(): string { return this.state.activeInspectorTab; }

    setProjectA(project: SpineProjectState | null): void {
        this.state.projectA = project;
        eventBus.emit('project:change', 'A', project);
    }

    setProjectB(project: SpineProjectState | null): void {
        this.state.projectB = project;
        eventBus.emit('project:change', 'B', project);
    }

    updateProjectA(updates: Partial<SpineProjectState>): void {
        if (this.state.projectA) {
            Object.assign(this.state.projectA, updates);
            eventBus.emit('project:update', 'A', updates);
        }
    }

    updateProjectB(updates: Partial<SpineProjectState>): void {
        if (this.state.projectB) {
            Object.assign(this.state.projectB, updates);
            eventBus.emit('project:update', 'B', updates);
        }
    }

    setViewport(updates: Partial<ViewportState>): void {
        Object.assign(this.state.viewport, updates);
        eventBus.emit('viewport:change', this.state.viewport);
    }

    setMode(mode: 'single' | 'comparison'): void {
        this.state.mode = mode;
        eventBus.emit('mode:change', mode);
    }

    setActiveTab(tab: string): void {
        this.state.activeInspectorTab = tab;
        eventBus.emit('tab:change', tab);
    }
}
