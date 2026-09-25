/**
 * Records a per-animation runtime cost profile keyed to timeline position, so
 * the track scrubber can show *where* in an animation the engine works hardest.
 *
 * Primary metric is draw-call count (reveals batch breaks from clipping, blend
 * modes and draw-order changes even when FPS isn't dropping). We keep the worst
 * value per timeline bucket — deterministic, so one play-through gives a stable
 * profile. Without draw calls it falls back to frame time, averaged per bucket
 * (peaks would just record GC / tab-switch noise) and scored against absolute
 * budgets, so a smooth animation never lights up red.
 */
const BUCKETS = 40;

/** Frame-time fallback: at/below this is cold, at/above FRAME_MS_HOT is fully hot. */
const FRAME_MS_COLD = 18;
const FRAME_MS_HOT = 40;
/** Draw-call spread smaller than this (or than the baseline itself) never reads as hot. */
const MIN_DRAW_CALL_SPREAD = 2;

export type HeatMetric = 'drawCalls' | 'frameMs';

interface Profile {
    metric: HeatMetric;
    value: Float32Array; // peak draw calls, or summed frame ms
    count: Uint32Array;
}

export class PerfSampler {
    private profiles = new Map<string, Profile>();

    /** Record one frame's cost at a normalized [0,1] timeline position. */
    sample(animName: string, normalizedT: number, cost: number, metric: HeatMetric): void {
        if (!animName || cost <= 0) return;
        let p = this.profiles.get(animName);
        if (!p || p.metric !== metric) {
            p = { metric, value: new Float32Array(BUCKETS), count: new Uint32Array(BUCKETS) };
            this.profiles.set(animName, p);
        }
        const i = Math.min(BUCKETS - 1, Math.max(0, Math.floor(normalizedT * BUCKETS)));
        if (metric === 'drawCalls') {
            if (cost > p.value[i]) p.value[i] = cost;
        } else {
            p.value[i] += cost;
        }
        p.count[i]++;
    }

    /** Per-bucket cost in the metric's unit (mean for frame time); -1 = unsampled. */
    private values(p: Profile): number[] {
        return Array.from(p.value, (v, i) => {
            const n = p.count[i];
            if (n === 0) return -1;
            return p.metric === 'drawCalls' ? v : v / n;
        });
    }

    /** Heat in [0,1] per bucket (-1 = unsampled), or null if the animation was never sampled. */
    getHeat(animName: string): number[] | null {
        const p = this.profiles.get(animName);
        if (!p) return null;
        const vals = this.values(p);
        const sampled = vals.filter(v => v >= 0);
        if (sampled.length === 0) return null;

        if (p.metric === 'frameMs') {
            return vals.map(v => v < 0 ? -1 : Math.max(0, Math.min(1, (v - FRAME_MS_COLD) / (FRAME_MS_HOT - FRAME_MS_COLD))));
        }
        const min = Math.min(...sampled);
        const max = Math.max(...sampled);
        const spread = Math.max(max - min, min, MIN_DRAW_CALL_SPREAD);
        return vals.map(v => v < 0 ? -1 : (v - min) / spread);
    }

    /** Short legend for the heat strip, e.g. "dc 4–12" or "avg 16–22 ms". */
    getLegend(animName: string): { text: string; title: string } | null {
        const p = this.profiles.get(animName);
        if (!p) return null;
        const sampled = this.values(p).filter(v => v >= 0);
        if (sampled.length === 0) return null;
        const min = Math.min(...sampled);
        const max = Math.max(...sampled);
        if (p.metric === 'drawCalls') {
            return {
                text: min === max ? `${min} dc` : `${min}–${max} dc`,
                title: `Heatmap: peak draw calls per timeline position (${min}–${max}).\n`
                    + 'Green = this animation\'s cheapest moments, red = batch breaks (clipping, blend modes, draw order).\n'
                    + 'Grey = not played yet.',
            };
        }
        return {
            text: `${Math.round(min)}–${Math.round(max)} ms`,
            title: `Heatmap: average frame time per timeline position (${min.toFixed(1)}–${max.toFixed(1)} ms).\n`
                + `Green ≤ ${FRAME_MS_COLD} ms, red ≥ ${FRAME_MS_HOT} ms. Draw calls unavailable on this renderer.\n`
                + 'Grey = not played yet.',
        };
    }

    reset(): void {
        this.profiles.clear();
    }
}
