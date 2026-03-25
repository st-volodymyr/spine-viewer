import { SpineElement } from '@electricelephants/pixi-ext';
import type { SkeletonData, TrackEntry, AnimationStateListener } from '@electricelephants/pixi-ext';
import { eventBus } from './EventBus';
import type { Viewport } from './Viewport';

export interface SpineEventData {
    type: 'start' | 'complete' | 'end' | 'interrupt' | 'dispose' | 'event';
    trackIndex: number;
    animationName: string;
    eventName?: string;
    time: number;
}

export class SpineManager {
    spine: SpineElement | null = null;
    private viewport: Viewport;
    private projectName: string = '';
    private listener: AnimationStateListener | null = null;

    constructor(viewport: Viewport) {
        this.viewport = viewport;
    }

    createSpine(projectName: string): SpineElement {
        this.destroy();
        this.projectName = projectName;

        this.spine = new SpineElement(projectName);
        this.viewport.wrapper.addChild(this.spine);
        this.attachListeners();

        return this.spine;
    }

    private attachListeners(): void {
        if (!this.spine) return;

        this.listener = {
            start: (entry: TrackEntry) => {
                eventBus.emit('spine:event', {
                    type: 'start',
                    trackIndex: entry.trackIndex,
                    animationName: entry.animation?.name ?? '',
                    time: entry.trackTime,
                } as SpineEventData);
            },
            complete: (entry: TrackEntry) => {
                eventBus.emit('spine:event', {
                    type: 'complete',
                    trackIndex: entry.trackIndex,
                    animationName: entry.animation?.name ?? '',
                    time: entry.trackTime,
                } as SpineEventData);
            },
            end: (entry: TrackEntry) => {
                eventBus.emit('spine:event', {
                    type: 'end',
                    trackIndex: entry.trackIndex,
                    animationName: entry.animation?.name ?? '',
                    time: entry.trackTime,
                } as SpineEventData);
            },
            interrupt: (entry: TrackEntry) => {
                eventBus.emit('spine:event', {
                    type: 'interrupt',
                    trackIndex: entry.trackIndex,
                    animationName: entry.animation?.name ?? '',
                    time: entry.trackTime,
                } as SpineEventData);
            },
            dispose: (entry: TrackEntry) => {
                eventBus.emit('spine:event', {
                    type: 'dispose',
                    trackIndex: entry.trackIndex,
                    animationName: entry.animation?.name ?? '',
                    time: entry.trackTime,
                } as SpineEventData);
            },
            event: (entry: TrackEntry, event: any) => {
                eventBus.emit('spine:event', {
                    type: 'event',
                    trackIndex: entry.trackIndex,
                    animationName: entry.animation?.name ?? '',
                    eventName: event.data?.name ?? '',
                    time: entry.trackTime,
                } as SpineEventData);
            },
        };

        this.spine.state.addListener(this.listener);
    }

    get spineData(): SkeletonData | null {
        return this.spine?.spineData ?? null;
    }

    getAnimationNames(): string[] {
        return this.spineData?.animations.map(a => a.name) ?? [];
    }

    getSkinNames(): string[] {
        return this.spineData?.skins.map(s => s.name) ?? [];
    }

    getBoneNames(): string[] {
        return this.spineData?.bones.map(b => b.name) ?? [];
    }

    getSlotNames(): string[] {
        return this.spineData?.slots.map(s => s.name) ?? [];
    }

    getEventNames(): string[] {
        return this.spineData?.events.map(e => e.name) ?? [];
    }

    setAnimation(trackIndex: number, name: string, loop: boolean): TrackEntry | null {
        if (!this.spine) return null;
        return this.spine.setAnimation(trackIndex, name, loop);
    }

    addAnimation(trackIndex: number, name: string, loop: boolean, delay = 0): TrackEntry | null {
        if (!this.spine) return null;
        return this.spine.addAnimation(trackIndex, name, loop, delay);
    }

    setSkin(name: string): void {
        if (!this.spine) return;
        this.spine.skeleton.setSkinByName(name);
        this.spine.skeleton.setSlotsToSetupPose();
    }

    setSpeed(speed: number): void {
        if (!this.spine) return;
        this.spine.state.timeScale = speed;
    }

    setPaused(paused: boolean): void {
        if (!this.spine) return;
        this.spine.autoUpdate = !paused;
    }

    setScale(scale: number): void {
        if (!this.spine) return;
        this.spine.scale.set(scale, scale);
    }

    setFlip(flipX: boolean, flipY: boolean): void {
        if (!this.spine) return;
        this.spine.scale.x = Math.abs(this.spine.scale.x) * (flipX ? -1 : 1);
        this.spine.scale.y = Math.abs(this.spine.scale.y) * (flipY ? -1 : 1);
    }

    resetPose(): void {
        if (!this.spine) return;
        this.spine.skeleton.setToSetupPose();
        this.spine.state.update(0);
        this.spine.state.apply(this.spine.skeleton);
    }

    clearTrack(trackIndex: number): void {
        if (!this.spine) return;
        this.spine.state.clearTrack(trackIndex);
        this.spine.state.setEmptyAnimation(trackIndex, 0);
    }

    getCurrentTrackInfo(trackIndex: number): { name: string; time: number; duration: number; loop: boolean } | null {
        if (!this.spine) return null;
        const current = this.spine.state.getCurrent(trackIndex);
        if (!current || !current.animation) return null;
        return {
            name: current.animation.name,
            time: current.trackTime % current.animation.duration,
            duration: current.animation.duration,
            loop: current.loop,
        };
    }

    destroy(): void {
        if (this.spine) {
            if (this.listener) {
                this.spine.state.removeListener(this.listener);
            }
            this.spine.destroy();
            this.spine = null;
        }
        this.projectName = '';
    }
}
