/**
 * FrameLog — ring-buffered log of slow frames (delta > threshold) and browser
 * long tasks (PerformanceObserver 'longtask', Chrome only).
 *
 * Hot path (`onFrame`) is one comparison when the frame is fast: nothing is
 * allocated unless a slow frame is actually recorded. Context (which
 * animations were playing, draw calls, paused) is pulled lazily through the
 * `getContext` callback only for slow frames.
 */

export type FrameLogKind = 'frame' | 'longtask';

export interface FrameLogEntry {
    /** Monotonic id (for DOM diffing). */
    id: number;
    kind: FrameLogKind;
    /** ms since log start (performance.now() based). */
    t: number;
    /** Frame delta or long-task duration, ms. */
    ms: number;
    drawCalls: number | null;
    paused: boolean;
    /** Human-readable "what was playing" string. */
    context: string;
}

export interface FrameContext {
    drawCalls: number | null;
    paused: boolean;
    context: string;
}

/** Frames right after a load / tab return are huge and meaningless. */
const GRACE_MS = 1000;

export class FrameLog {
    readonly capacity: number;
    threshold = 1000 / 30;
    enabled = true;

    // Counters (survive ring eviction; reset by clear()).
    slowFrames = 0;
    worstFrameMs = 0;
    longTasks = 0;

    readonly longTaskSupported: boolean;

    private ring: (FrameLogEntry | null)[];
    private head = 0;       // next write index
    private size = 0;
    private nextId = 1;
    private startTime = performance.now();
    private graceUntil = performance.now() + GRACE_MS;
    private observer: PerformanceObserver | null = null;

    /** Entries recorded since the last `drainNew()` (bounded by capacity). */
    private pending: FrameLogEntry[] = [];
    private cleared = false;

    constructor(private getContext: () => FrameContext, capacity = 200) {
        this.capacity = capacity;
        this.ring = new Array(capacity).fill(null);

        const types = (typeof PerformanceObserver !== 'undefined'
            && (PerformanceObserver as any).supportedEntryTypes) as string[] | undefined;
        this.longTaskSupported = !!types && types.includes('longtask');
        if (this.longTaskSupported) {
            try {
                this.observer = new PerformanceObserver((list) => this.onLongTasks(list));
                this.observer.observe({ type: 'longtask', buffered: false });
            } catch {
                this.observer = null;
            }
        }

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') this.suppress();
        });
    }

    /** Ignore frames for the next ~1s (project load, tab return, resume). */
    suppress(ms = GRACE_MS): void {
        this.graceUntil = performance.now() + ms;
    }

    /** Called every ticker frame with the raw (unclamped) frame delta. */
    onFrame(deltaMs: number): void {
        if (deltaMs <= this.threshold || !this.enabled) return;
        if (document.visibilityState !== 'visible') return;
        const now = performance.now();
        if (now < this.graceUntil) return;

        const ctx = this.getContext();
        this.slowFrames++;
        if (deltaMs > this.worstFrameMs) this.worstFrameMs = deltaMs;
        this.push('frame', now, deltaMs, ctx);
    }

    private onLongTasks(list: PerformanceObserverEntryList): void {
        if (!this.enabled || document.visibilityState !== 'visible') return;
        for (const e of list.getEntries()) {
            if (e.startTime < this.graceUntil) continue;
            if (e.startTime < this.startTime) continue; // before last clear
            this.longTasks++;
            const ctx = this.getContext();
            this.push('longtask', e.startTime, e.duration, ctx);
        }
    }

    private push(kind: FrameLogKind, absTime: number, ms: number, ctx: FrameContext): void {
        const entry: FrameLogEntry = {
            id: this.nextId++,
            kind,
            t: absTime - this.startTime,
            ms,
            drawCalls: ctx.drawCalls,
            paused: ctx.paused,
            context: ctx.context,
        };
        this.ring[this.head] = entry;
        this.head = (this.head + 1) % this.capacity;
        if (this.size < this.capacity) this.size++;
        this.pending.push(entry);
        if (this.pending.length > this.capacity) this.pending.shift();
    }

    /** New entries since the previous call (oldest first) + whether a clear happened. */
    drainNew(): { cleared: boolean; entries: FrameLogEntry[] } {
        const out = { cleared: this.cleared, entries: this.pending };
        if (this.pending.length > 0) this.pending = [];
        this.cleared = false;
        return out;
    }

    /** All buffered entries, oldest first. */
    entries(): FrameLogEntry[] {
        const out: FrameLogEntry[] = [];
        const start = (this.head - this.size + this.capacity) % this.capacity;
        for (let i = 0; i < this.size; i++) {
            const e = this.ring[(start + i) % this.capacity];
            if (e) out.push(e);
        }
        return out;
    }

    clear(): void {
        this.ring.fill(null);
        this.head = 0;
        this.size = 0;
        this.pending = [];
        this.cleared = true;
        this.slowFrames = 0;
        this.worstFrameMs = 0;
        this.longTasks = 0;
        this.startTime = performance.now();
    }

    /** TSV dump for bug reports. */
    toText(): string {
        const lines: string[] = [];
        lines.push(`# Spine Viewer frame log — ${new Date().toISOString()}`);
        lines.push(`# threshold ${this.threshold.toFixed(1)} ms | slow frames ${this.slowFrames} | worst ${this.worstFrameMs.toFixed(1)} ms | long tasks ${this.longTaskLabel()}`);
        lines.push(`# ${navigator.userAgent}`);
        lines.push(['time', 'kind', 'ms', 'drawCalls', 'paused', 'context'].join('\t'));
        for (const e of this.entries()) {
            lines.push([
                formatLogTime(e.t),
                e.kind,
                e.ms.toFixed(1),
                e.drawCalls ?? '',
                e.paused ? 'paused' : '',
                e.context,
            ].join('\t'));
        }
        return lines.join('\n');
    }

    private longTaskLabel(): string {
        return this.longTaskSupported ? String(this.longTasks) : 'n/a';
    }

    destroy(): void {
        this.observer?.disconnect();
        this.observer = null;
    }
}

/** mm:ss.mmm */
export function formatLogTime(ms: number): string {
    const total = Math.max(0, ms);
    const m = Math.floor(total / 60000);
    const s = Math.floor((total % 60000) / 1000);
    const r = Math.floor(total % 1000);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
}
