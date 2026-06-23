/**
 * Records a per-animation runtime cost profile keyed to timeline position, so
 * the track scrubber can show *where* in an animation the engine works hardest.
 *
 * Primary metric is draw-call count (reveals batch breaks from clipping, blend
 * modes and draw-order changes even when FPS isn't dropping); it falls back to
 * frame time when the renderer doesn't expose draw calls. We keep the worst
 * value seen per timeline bucket — after one full play-through every bucket
 * reflects its true peak cost, giving a stable heat profile.
 */
const BUCKETS = 40;

export class PerfSampler {
    private peak = new Map<string, Float32Array>();

    /** Record one frame's cost at a normalized [0,1] timeline position. */
    sample(animName: string, normalizedT: number, cost: number): void {
        if (!animName || cost <= 0) return;
        let arr = this.peak.get(animName);
        if (!arr) {
            arr = new Float32Array(BUCKETS); // 0 = not yet sampled
            this.peak.set(animName, arr);
        }
        const i = Math.min(BUCKETS - 1, Math.max(0, Math.floor(normalizedT * BUCKETS)));
        if (cost > arr[i]) arr[i] = cost;
    }

    /**
     * Heat per bucket normalized to this animation's own [min,max] range, so the
     * heaviest moments stand out even on a fast machine. Returns null if unsampled;
     * unsampled buckets within a sampled animation are -1.
     */
    getHeat(animName: string): number[] | null {
        const arr = this.peak.get(animName);
        if (!arr) return null;
        let min = Infinity;
        let max = -Infinity;
        for (const v of arr) {
            if (v <= 0) continue;
            if (v < min) min = v;
            if (v > max) max = v;
        }
        if (max < 0) return null;
        const range = max - min;
        return Array.from(arr, v => {
            if (v <= 0) return -1;
            return range > 0 ? (v - min) / range : 0;
        });
    }

    reset(): void {
        this.peak.clear();
    }
}
