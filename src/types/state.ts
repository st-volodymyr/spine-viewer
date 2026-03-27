import type { TrackState } from './spine';

export interface SpineProjectState {
    name: string;
    version: '4.1' | '4.2' | 'unknown';
    fullVersion: string;
    currentTrack: number;
    tracks: TrackState[];
    speed: number;
    paused: boolean;
    scale: number;
    flipX: boolean;
    flipY: boolean;
    currentSkin: string;
    animationNames: string[];
    skinNames: string[];
    boneNames: string[];
    slotNames: string[];
    eventNames: string[];
}

export interface ViewportState {
    zoom: number;
    panX: number;
    panY: number;
    bgColor: string;
    showGrid: boolean;
}

export interface AppState {
    projectA: SpineProjectState | null;
    projectB: SpineProjectState | null;
    viewport: ViewportState;
    mode: 'single' | 'comparison';
    activeInspectorTab: string;
}

export interface ComparisonDiff {
    animationsOnlyA: string[];
    animationsOnlyB: string[];
    animationsShared: string[];
    skinsOnlyA: string[];
    skinsOnlyB: string[];
    skinsShared: string[];
    slotsOnlyA: string[];
    slotsOnlyB: string[];
    bonesOnlyA: string[];
    bonesOnlyB: string[];
    eventsOnlyA: string[];
    eventsOnlyB: string[];
    eventsShared: string[];
}

export interface AnimationDiffEntry {
    name: string;
    status: 'shared' | 'only-a' | 'only-b';
    durationA?: number;
    durationB?: number;
}

export interface DiffSummary {
    bonesA: number;
    bonesB: number;
    slotsA: number;
    slotsB: number;
    skinsA: number;
    skinsB: number;
    eventsA: number;
    eventsB: number;
    animsShared: number;
    animsOnlyA: number;
    animsOnlyB: number;
}

export interface StructuredDiff {
    animations: AnimationDiffEntry[];
    summary: DiffSummary;
    skinsOnlyA: string[];
    skinsOnlyB: string[];
    skinsShared: string[];
    bonesOnlyA: string[];
    bonesOnlyB: string[];
    slotsOnlyA: string[];
    slotsOnlyB: string[];
    eventsOnlyA: string[];
    eventsOnlyB: string[];
    eventsShared: string[];
}
