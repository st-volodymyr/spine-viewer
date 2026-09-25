import { SpineElement, Skin } from '@electricelephants/pixi-ext';
import type { SkeletonData, TrackEntry, AnimationStateListener } from '@electricelephants/pixi-ext';
import { SkeletonDebug } from '../services/SkeletonDebug';
import { Spine as Spine41 } from '@pixi-spine/all-4.1';
import type { SkeletonData as SkeletonData41 } from '@pixi-spine/all-4.1';
import { eventBus } from './EventBus';
import type { Viewport } from './Viewport';
import { profileSkeleton, type ProfileResult } from '../services/AnimationProfiler';
import { collectEventKeys, type EventKey, type EventKeyMap } from '../services/EventKeys';

export interface DebugDrawOptions {
    bones: boolean;
    meshes: boolean;
    boundingBoxes: boolean;
    regions: boolean;
    clipping: boolean;
    paths: boolean;
    origin: boolean;
}

export interface SpineEventData {
    type: 'start' | 'complete' | 'end' | 'interrupt' | 'dispose' | 'event';
    trackIndex: number;
    animationName: string;
    eventName?: string;
    /** Key time of the fired custom event (seconds), for matching against EventKeys. */
    eventTime?: number;
    time: number;
    projectName?: string;
}

type AnySpine = SpineElement | Spine41;

/**
 * AABB of the region/mesh attachments that actually show in the current pose. Unlike
 * `Skeleton.getBounds` it skips transparent slots (hidden pop-ups/glows parked at alpha 0)
 * and duck-types attachments instead of using `instanceof` (see SkeletonDebug).
 */
function visibleSkeletonBounds(skeleton: any): { minX: number; minY: number; maxX: number; maxY: number } | null {
    if ((skeleton.color?.a ?? 1) <= 0.01) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const v: number[] = [];
    for (const slot of (skeleton.drawOrder ?? skeleton.slots ?? []) as any[]) {
        if (!slot?.bone?.active || (slot.color?.a ?? 1) <= 0.01) continue;
        const att = slot.getAttachment?.() ?? slot.attachment;
        if (!att || typeof att.computeWorldVertices !== 'function' || (att.color?.a ?? 1) <= 0.01) continue;
        let n = 0;
        try {
            if (Array.isArray(att.triangles) && att.worldVerticesLength) {
                n = att.worldVerticesLength; // mesh
                att.computeWorldVertices(slot, 0, n, v, 0, 2);
            } else if (att.worldVerticesLength === undefined) {
                n = 8; // region quad
                att.computeWorldVertices(slot, v, 0, 2);
            }
        } catch { continue; }
        for (let i = 0; i < n; i += 2) {
            const x = v[i], y = v[i + 1];
            if (!isFinite(x) || !isFinite(y)) continue;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    }
    return isFinite(minX) && maxX > minX && maxY > minY ? { minX, minY, maxX, maxY } : null;
}

function isSpineElement(s: AnySpine): s is SpineElement {
    return s instanceof SpineElement;
}

export class SpineManager {
    spine: AnySpine | null = null;
    displayName = '';
    private viewport: Viewport;
    private projectName: string = '';
    private listener: AnimationStateListener | null = null;
    private debug: SkeletonDebug | null = null;
    private profileCache: ProfileResult | null = null;
    private eventKeysCache: EventKeyMap | null = null;

    constructor(viewport: Viewport) {
        this.viewport = viewport;
        // Redraw the debug overlay each frame from the live skeleton pose.
        this.viewport.ticker.add(() => this.debug?.update());
    }

    /** Static animation cost analysis for the current skeleton (memoized). */
    profile(): ProfileResult | null {
        const data = this.spineData;
        if (!data) return null;
        if (!this.profileCache) this.profileCache = profileSkeleton(data);
        return this.profileCache;
    }

    /** Static event keyframes of an animation, sorted by time (memoized per load). */
    getEventKeys(animName: string): EventKey[] {
        return this.getAllEventKeys().get(animName) ?? [];
    }

    getAllEventKeys(): EventKeyMap {
        if (!this.eventKeysCache) this.eventKeysCache = collectEventKeys(this.spineData);
        return this.eventKeysCache;
    }

    createSpine(projectName: string): SpineElement {
        this.destroy();
        this.profileCache = null;
        this.eventKeysCache = null;
        this.projectName = projectName;
        this.spine = new SpineElement(projectName);
        this.viewport.wrapper.addChild(this.spine);
        this.attachListeners();
        return this.spine as SpineElement;
    }

    createSpine41(skeletonData: SkeletonData41): Spine41 {
        this.destroy();
        this.profileCache = null;
        this.eventKeysCache = null;
        this.projectName = '';
        const spine41 = new Spine41(skeletonData as any);
        this.spine = spine41;
        this.viewport.wrapper.addChild(spine41);
        this.attachListeners();
        return spine41;
    }

    /**
     * Create a detached spine of the same skeleton (NOT added to the viewport and
     * with no event listeners). Caller owns it — used for ghosts and stress-test
     * clones. Shares cached skeleton/atlas data and textures with the main spine.
     */
    cloneSpine(): AnySpine | null {
        if (!this.spine) return null;
        if (isSpineElement(this.spine)) return new SpineElement(this.projectName);
        const data = (this.spine as Spine41).spineData;
        return data ? new Spine41(data as any) : null;
    }

    /** True when the current pose draws at least one visible region/mesh. */
    hasVisiblePose(): boolean {
        return !!this.spine && visibleSkeletonBounds(this.spine.skeleton) !== null;
    }

    /**
     * Bounds to frame the skeleton, in the spine's parent (viewport wrapper) space.
     * While something plays: the current pose. In setup pose (often empty): the union of
     * the setup pose and poses sampled across every animation, posed on a detached clone
     * so the live state is untouched. Null when there is nothing visible to frame.
     */
    getFitBounds(): { x: number; y: number; width: number; height: number } | null {
        const spine = this.spine as any;
        if (!spine) return null;
        const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        const addSkeleton = (skeleton: any) => {
            const b = visibleSkeletonBounds(skeleton);
            if (!b) return;
            box.minX = Math.min(box.minX, b.minX);
            box.minY = Math.min(box.minY, b.minY);
            box.maxX = Math.max(box.maxX, b.maxX);
            box.maxY = Math.max(box.maxY, b.maxY);
        };

        addSkeleton(spine.skeleton);
        const animations: any[] = (this.spineData as any)?.animations ?? [];
        if (this.getAllActiveTracks().length === 0 && animations.length > 0) {
            const clone = this.cloneSpine() as any;
            if (clone) {
                clone.skeleton.setSkin(spine.skeleton.skin);
                clone.skeleton.setSlotsToSetupPose();
                // Cap total pose evaluations so huge skeletons stay responsive.
                const samples = Math.max(2, Math.min(6, Math.floor(240 / animations.length)));
                for (const anim of animations) {
                    const duration = anim.duration || 0;
                    for (let i = 0; i < samples; i++) {
                        clone.state.clearTracks();
                        clone.skeleton.setToSetupPose();
                        const entry = clone.state.setAnimation(0, anim.name, false);
                        entry.mixDuration = 0;
                        entry.trackTime = duration * i / (samples - 1);
                        clone.update(0);
                        addSkeleton(clone.skeleton);
                    }
                }
                clone.destroy();
            }
        }
        if (!isFinite(box.minX)) return null;

        // Skeleton space → parent space (spine position, scale and flip).
        const sx = spine.scale.x, sy = spine.scale.y;
        const xs = [box.minX * sx, box.maxX * sx], ys = [box.minY * sy, box.maxY * sy];
        const x = spine.x + Math.min(...xs), y = spine.y + Math.min(...ys);
        return { x, y, width: Math.abs(xs[1] - xs[0]), height: Math.abs(ys[1] - ys[0]) };
    }

    private attachListeners(): void {
        if (!this.spine) return;

        this.listener = {
            start: (entry: TrackEntry) => {
                this.emitEvent({
                    type: 'start',
                    trackIndex: entry.trackIndex,
                    animationName: entry.animation?.name ?? '',
                    time: entry.trackTime,
                    projectName: this.displayName || undefined,
                } as SpineEventData);
            },
            complete: (entry: TrackEntry) => {
                this.emitEvent({
                    type: 'complete',
                    trackIndex: entry.trackIndex,
                    animationName: entry.animation?.name ?? '',
                    time: entry.trackTime,
                    projectName: this.displayName || undefined,
                } as SpineEventData);
            },
            end: (entry: TrackEntry) => {
                this.emitEvent({
                    type: 'end',
                    trackIndex: entry.trackIndex,
                    animationName: entry.animation?.name ?? '',
                    time: entry.trackTime,
                    projectName: this.displayName || undefined,
                } as SpineEventData);
            },
            interrupt: (entry: TrackEntry) => {
                this.emitEvent({
                    type: 'interrupt',
                    trackIndex: entry.trackIndex,
                    animationName: entry.animation?.name ?? '',
                    time: entry.trackTime,
                    projectName: this.displayName || undefined,
                } as SpineEventData);
            },
            dispose: (entry: TrackEntry) => {
                this.emitEvent({
                    type: 'dispose',
                    trackIndex: entry.trackIndex,
                    animationName: entry.animation?.name ?? '',
                    time: entry.trackTime,
                    projectName: this.displayName || undefined,
                } as SpineEventData);
            },
            event: (entry: TrackEntry, event: any) => {
                this.emitEvent({
                    type: 'event',
                    trackIndex: entry.trackIndex,
                    animationName: entry.animation?.name ?? '',
                    eventName: event.data?.name ?? '',
                    eventTime: event.time,
                    time: entry.trackTime,
                    projectName: this.displayName || undefined,
                } as SpineEventData);
            },
        };

        this.spine.state.addListener(this.listener as any);
    }

    private emitEvent(data: SpineEventData): void {
        eventBus.emit('spine:event', data);
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

    /** Default crossfade (mix) duration in seconds applied when switching animations. */
    setDefaultMix(seconds: number): void {
        if (!this.spine) return;
        const data = (this.spine.state as any)?.data;
        if (data) data.defaultMix = Math.max(0, seconds);
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

    /**
     * Toggle the skeleton debug overlay (bones, meshes, bounds, regions, clipping,
     * paths). Uses our own duck-typed renderer (see SkeletonDebug) so every flag
     * works regardless of which spine-runtime copy created the attachments. Works
     * for both the 4.2 and 4.1 runtimes.
     */
    setDebugOptions(opts: DebugDrawOptions | null): void {
        if (!this.spine) return;
        const anyOn = !!opts && (opts.bones || opts.meshes || opts.boundingBoxes || opts.regions || opts.clipping || opts.paths || opts.origin);

        if (!anyOn) {
            this.debug?.destroy();
            this.debug = null;
            return;
        }

        if (!this.debug) this.debug = new SkeletonDebug(this.spine);
        this.debug.setFlags(opts!);
        this.debug.update();
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
        // Tear down the debug overlay before destroying the spine that parents it.
        this.debug?.destroy();
        this.debug = null;
        if (this.spine) {
            if (this.listener) {
                this.spine.state.removeListener(this.listener as any);
            }
            this.spine.destroy();
            this.spine = null;
        }
        this.projectName = '';
    }
}
