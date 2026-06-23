import { SpineElement, Skin } from '@electricelephants/pixi-ext';
import type { SkeletonData, TrackEntry, AnimationStateListener } from '@electricelephants/pixi-ext';
import { SpineDebugRenderer } from '@esotericsoftware/spine-pixi-v7';
import { Spine as Spine41 } from '@pixi-spine/all-4.1';
import type { SkeletonData as SkeletonData41 } from '@pixi-spine/all-4.1';
import { eventBus } from './EventBus';
import type { Viewport } from './Viewport';
import { profileSkeleton, type ProfileResult } from '../services/AnimationProfiler';

export interface DebugDrawOptions {
    bones: boolean;
    meshes: boolean;
    boundingBoxes: boolean;
    regions: boolean;
    clipping: boolean;
    paths: boolean;
}

export interface SpineEventData {
    type: 'start' | 'complete' | 'end' | 'interrupt' | 'dispose' | 'event';
    trackIndex: number;
    animationName: string;
    eventName?: string;
    time: number;
    projectName?: string;
}

type AnySpine = SpineElement | Spine41;

function isSpineElement(s: AnySpine): s is SpineElement {
    return s instanceof SpineElement;
}

export class SpineManager {
    spine: AnySpine | null = null;
    displayName = '';
    private viewport: Viewport;
    private projectName: string = '';
    private listener: AnimationStateListener | null = null;
    private debugRenderer: SpineDebugRenderer | null = null;
    private profileCache: ProfileResult | null = null;

    constructor(viewport: Viewport) {
        this.viewport = viewport;
    }

    /** Static animation cost analysis for the current skeleton (memoized). */
    profile(): ProfileResult | null {
        const data = this.spineData;
        if (!data) return null;
        if (!this.profileCache) this.profileCache = profileSkeleton(data);
        return this.profileCache;
    }

    createSpine(projectName: string): SpineElement {
        this.destroy();
        this.profileCache = null;
        this.projectName = projectName;
        this.spine = new SpineElement(projectName);
        this.viewport.wrapper.addChild(this.spine);
        this.attachListeners();
        return this.spine as SpineElement;
    }

    createSpine41(skeletonData: SkeletonData41): Spine41 {
        this.destroy();
        this.profileCache = null;
        this.projectName = '';
        const spine41 = new Spine41(skeletonData as any);
        this.spine = spine41;
        this.viewport.wrapper.addChild(spine41);
        this.attachListeners();
        return spine41;
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
                    projectName: this.displayName || undefined,
                } as SpineEventData);
            },
            complete: (entry: TrackEntry) => {
                eventBus.emit('spine:event', {
                    type: 'complete',
                    trackIndex: entry.trackIndex,
                    animationName: entry.animation?.name ?? '',
                    time: entry.trackTime,
                    projectName: this.displayName || undefined,
                } as SpineEventData);
            },
            end: (entry: TrackEntry) => {
                eventBus.emit('spine:event', {
                    type: 'end',
                    trackIndex: entry.trackIndex,
                    animationName: entry.animation?.name ?? '',
                    time: entry.trackTime,
                    projectName: this.displayName || undefined,
                } as SpineEventData);
            },
            interrupt: (entry: TrackEntry) => {
                eventBus.emit('spine:event', {
                    type: 'interrupt',
                    trackIndex: entry.trackIndex,
                    animationName: entry.animation?.name ?? '',
                    time: entry.trackTime,
                    projectName: this.displayName || undefined,
                } as SpineEventData);
            },
            dispose: (entry: TrackEntry) => {
                eventBus.emit('spine:event', {
                    type: 'dispose',
                    trackIndex: entry.trackIndex,
                    animationName: entry.animation?.name ?? '',
                    time: entry.trackTime,
                    projectName: this.displayName || undefined,
                } as SpineEventData);
            },
            event: (entry: TrackEntry, event: any) => {
                eventBus.emit('spine:event', {
                    type: 'event',
                    trackIndex: entry.trackIndex,
                    animationName: entry.animation?.name ?? '',
                    eventName: event.data?.name ?? '',
                    time: entry.trackTime,
                    projectName: this.displayName || undefined,
                } as SpineEventData);
            },
        };

        this.spine.state.addListener(this.listener as any);
    }

    get spineData(): SkeletonData | SkeletonData41 | null {
        if (!this.spine) return null;
        if (isSpineElement(this.spine)) return this.spine.spineData;
        return (this.spine as Spine41).spineData as SkeletonData41;
    }

    getAnimationNames(): string[] {
        return this.spineData?.animations.map((a: any) => a.name) ?? [];
    }

    getSkinNames(): string[] {
        return this.spineData?.skins.map((s: any) => s.name) ?? [];
    }

    getBoneNames(): string[] {
        return this.spineData?.bones.map((b: any) => b.name) ?? [];
    }

    getSlotNames(): string[] {
        return this.spineData?.slots.map((s: any) => s.name) ?? [];
    }

    getEventNames(): string[] {
        return this.spineData?.events.map((e: any) => e.name) ?? [];
    }

    getAnimationDuration(name: string): number | null {
        const anim = this.spineData?.animations.find((a: any) => a.name === name);
        return anim ? (anim as any).duration : null;
    }

    setAnimation(trackIndex: number, name: string, loop: boolean): TrackEntry | null {
        if (!this.spine) return null;
        if (isSpineElement(this.spine)) {
            return this.spine.setAnimation(trackIndex, name, loop);
        }
        return (this.spine.state as any).setAnimation(trackIndex, name, loop);
    }

    addAnimation(trackIndex: number, name: string, loop: boolean, delay = 0): TrackEntry | null {
        if (!this.spine) return null;
        if (isSpineElement(this.spine)) {
            return this.spine.addAnimation(trackIndex, name, loop, delay);
        }
        return (this.spine.state as any).addAnimation(trackIndex, name, loop, delay);
    }

    setSkin(name: string): void {
        if (!this.spine) return;
        this.spine.skeleton.setSkinByName(name);
        this.spine.skeleton.setSlotsToSetupPose();
    }

    /**
     * Apply one or more skins simultaneously. Multiple skins are merged into a
     * single combined skin (Spine 4.2 only). On the 4.1 fallback runtime only the
     * first skin is applied.
     */
    setSkins(names: string[]): void {
        if (!this.spine) return;
        const skeleton = this.spine.skeleton as any;

        if (!isSpineElement(this.spine)) {
            // 4.1 runtime: combined skins unsupported — apply the first one.
            skeleton.setSkinByName(names[0] ?? 'default');
            skeleton.setSlotsToSetupPose();
            return;
        }

        if (names.length === 0) {
            skeleton.setSkin(null);
            skeleton.setToSetupPose();
            return;
        }
        if (names.length === 1) {
            skeleton.setSkinByName(names[0]);
            skeleton.setSlotsToSetupPose();
            return;
        }

        const combined = new Skin('sv-combined');
        for (const name of names) {
            const skin = skeleton.data.findSkin(name);
            if (skin) combined.addSkin(skin);
        }
        skeleton.setSkin(combined);
        skeleton.setSlotsToSetupPose();
    }

    setSpeed(speed: number): void {
        if (!this.spine) return;
        this.spine.state.timeScale = speed;
    }

    getSpeed(): number {
        if (!this.spine) return 1;
        return this.spine.state.timeScale;
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

    setAnimationsList(trackIndex: number, names: string[], loop: boolean): void {
        if (!this.spine) return;
        if (isSpineElement(this.spine)) {
            this.spine.setAnimationsList(trackIndex, names, loop);
        } else {
            // Fallback for 4.1: queue via state
            const [first, ...rest] = names;
            if (first) (this.spine.state as any).setAnimation(trackIndex, first, rest.length === 0 && loop);
            rest.forEach(name => (this.spine!.state as any).addAnimation(trackIndex, name, loop, 0));
        }
    }

    resetPose(): void {
        if (!this.spine) return;
        const state: any = this.spine.state;
        // Remove all active animations first — otherwise state.apply() below would
        // immediately re-apply the current track's pose over the setup pose, making
        // the reset a no-op once any animation has been played.
        if (typeof state.clearTracks === 'function') state.clearTracks();
        this.spine.skeleton.setToSetupPose();
        state.update(0);
        state.apply(this.spine.skeleton);
    }

    clearTrack(trackIndex: number): void {
        if (!this.spine) return;
        this.spine.state.clearTrack(trackIndex);
        (this.spine.state as any).setEmptyAnimation(trackIndex, 0);
    }

    seekTo(trackIndex: number, time: number): void {
        if (!this.spine) return;
        const current = (this.spine.state as any).getCurrent(trackIndex);
        if (current) current.trackTime = time;
    }

    setTrackLoop(trackIndex: number, loop: boolean): void {
        if (!this.spine) return;
        const current = (this.spine.state as any).getCurrent(trackIndex);
        if (current) current.loop = loop;
    }

    isPaused(): boolean {
        if (!this.spine) return false;
        return (this.spine as any).autoUpdate === false;
    }

    /** Re-apply the current animation state to the skeleton without advancing time. */
    applyPose(): void {
        if (!this.spine) return;
        (this.spine as any).update(0);
    }

    /** Seek the given track to an absolute time, pausing playback and refreshing the pose. */
    seekToPaused(trackIndex: number, time: number): void {
        if (!this.spine) return;
        this.setPaused(true);
        const current = (this.spine.state as any).getCurrent(trackIndex);
        if (!current || !current.animation) return;
        const duration = current.animation.duration || 0;
        current.trackTime = duration > 0 ? Math.max(0, Math.min(time, duration)) : 0;
        this.applyPose();
    }

    /** Advance the given track by ±1 frame (defaults to 30 fps), pausing playback. */
    stepFrame(trackIndex: number, direction: 1 | -1, fps = 30): void {
        if (!this.spine) return;
        const current = (this.spine.state as any).getCurrent(trackIndex);
        if (!current || !current.animation) return;
        const duration = current.animation.duration || 0;
        const step = 1 / fps;
        let next = current.trackTime + direction * step;
        if (duration > 0) {
            // Wrap within [0, duration] so stepping past either end stays useful.
            next = ((next % duration) + duration) % duration;
        } else {
            next = 0;
        }
        this.seekToPaused(trackIndex, next);
    }

    /** Attach/update or detach the Spine debug renderer (bones, meshes, bounds, …). 4.2 only. */
    setDebugOptions(opts: DebugDrawOptions | null): void {
        if (!this.spine || !isSpineElement(this.spine)) return;
        const sp = this.spine as any;
        const anyOn = !!opts && (opts.bones || opts.meshes || opts.boundingBoxes || opts.regions || opts.clipping || opts.paths);

        if (!anyOn) {
            if (this.debugRenderer) {
                sp.debug = undefined;
                this.debugRenderer = null;
            }
            return;
        }

        const wasAttached = this.debugRenderer !== null;
        if (!this.debugRenderer) this.debugRenderer = new SpineDebugRenderer();
        const d = this.debugRenderer;
        d.drawBones = opts!.bones;
        d.drawMeshHull = opts!.meshes;
        d.drawMeshTriangles = opts!.meshes;
        d.drawBoundingBoxes = opts!.boundingBoxes;
        d.drawRegionAttachments = opts!.regions;
        d.drawClipping = opts!.clipping;
        d.drawPaths = opts!.paths;
        // Only (re)assign on the none→some transition; flag mutations apply live.
        if (!wasAttached) sp.debug = this.debugRenderer;
    }

    getCurrentSkin(): string | null {
        if (!this.spine) return null;
        return (this.spine.skeleton.skin as any)?.name ?? null;
    }

    getCurrentTrackInfo(trackIndex: number): { name: string; time: number; duration: number; loop: boolean } | null {
        if (!this.spine) return null;
        const current = (this.spine.state as any).getCurrent(trackIndex);
        if (!current || !current.animation) return null;
        const duration = current.animation.duration || 0;
        return {
            name: current.animation.name,
            // Looping wraps; a finished one-shot freezes at duration (trackTime keeps
            // growing internally, so modulo would make it appear to keep playing).
            time: duration > 0
                ? (current.loop ? current.trackTime % duration : Math.min(current.trackTime, duration))
                : 0,
            duration,
            loop: current.loop,
        };
    }

    getAllActiveTracks(): { trackIndex: number; name: string; time: number; duration: number; loop: boolean }[] {
        if (!this.spine) return [];
        const results: { trackIndex: number; name: string; time: number; duration: number; loop: boolean }[] = [];
        for (let i = 0; i < 12; i++) {
            const current = (this.spine.state as any).getCurrent(i);
            if (current?.animation) {
                const duration = current.animation.duration || 0;
                results.push({
                    trackIndex: i,
                    name: current.animation.name,
                    // Loop wraps; one-shot clamps at duration once finished.
                    time: duration > 0
                        ? (current.loop ? current.trackTime % duration : Math.min(current.trackTime, duration))
                        : 0,
                    duration,
                    loop: current.loop,
                });
            }
        }
        return results;
    }

    destroy(): void {
        if (this.spine) {
            if (this.listener) {
                this.spine.state.removeListener(this.listener as any);
            }
            this.spine.destroy();
            this.spine = null;
        }
        this.debugRenderer = null;
        this.projectName = '';
    }
}
