import type { SpineManager } from '../core/SpineManager';

export type QueueRepeat = 'once' | 'last' | 'all';

export interface QueueProgress {
    running: boolean;
    /** Index (in the queue list) of the entry currently playing, -1 when idle. */
    index: number;
    /** 1-based cycle counter for 'all' repeat. */
    cycle: number;
}

/**
 * Plays an animation list on one track, like the game's sequencing:
 *  - 'once': A → B → C, then stops on C's last frame
 *  - 'last': A → B → C, C loops
 *  - 'all':  A → B → C → A → … (the whole list re-queued when the last one starts)
 *
 * Progress is tracked with per-entry listeners; if anything else takes over the
 * track (another animation, clear, reset pose), the run reports itself stopped.
 */
export class QueuePlayer {
    private runId = 0;
    private ours = new WeakSet<object>();
    private progress: QueueProgress = { running: false, index: -1, cycle: 0 };
    private firstStarts = 0;

    constructor(
        private spineManager: SpineManager,
        private onProgress: (p: QueueProgress) => void,
    ) {}

    get state(): QueueProgress {
        return this.progress;
    }

    play(trackIndex: number, names: string[], repeat: QueueRepeat): void {
        if (names.length === 0) return;
        const run = ++this.runId;
        this.ours = new WeakSet();
        this.firstStarts = 0;
        this.setProgress({ running: true, index: 0, cycle: 1 });
        this.enqueue(run, trackIndex, names, repeat, true);
    }

    stop(trackIndex: number): void {
        const wasRunning = this.progress.running;
        this.runId++;
        this.setProgress({ running: false, index: -1, cycle: 0 });
        if (wasRunning) this.spineManager.clearTrack(trackIndex);
    }

    /** Forget the run without touching the track (e.g. project reload). */
    reset(): void {
        this.runId++;
        this.setProgress({ running: false, index: -1, cycle: 0 });
    }

    private enqueue(run: number, trackIndex: number, names: string[], repeat: QueueRepeat, first: boolean): void {
        names.forEach((name, i) => {
            const isLast = i === names.length - 1;
            const loop = isLast && repeat === 'last';
            const entry: any = first && i === 0
                ? this.spineManager.setAnimation(trackIndex, name, loop)
                : this.spineManager.addAnimation(trackIndex, name, loop, 0);
            if (!entry) return;
            this.ours.add(entry);
            entry.listener = {
                start: () => {
                    if (run !== this.runId) return;
                    if (i === 0) this.firstStarts++;
                    this.setProgress({ running: true, index: i, cycle: Math.max(1, this.firstStarts) });
                    // Seamless whole-list loop: queue the next cycle once the last entry starts.
                    if (isLast && repeat === 'all') this.enqueue(run, trackIndex, names, repeat, false);
                },
                complete: () => {
                    // A one-shot run finished its final entry.
                    if (run === this.runId && isLast && repeat === 'once') {
                        this.setProgress({ running: false, index: names.length, cycle: this.progress.cycle });
                    }
                },
                interrupt: () => this.checkTakenOver(run, trackIndex),
                end: () => this.checkTakenOver(run, trackIndex),
            };
        });
    }

    /** Deferred: after an entry of ours ends, is the track still playing one of ours? */
    private checkTakenOver(run: number, trackIndex: number): void {
        setTimeout(() => {
            if (run !== this.runId || !this.progress.running) return;
            const current = (this.spineManager.spine?.state as any)?.getCurrent(trackIndex);
            if (!current || !this.ours.has(current)) {
                this.runId++;
                this.setProgress({ running: false, index: -1, cycle: 0 });
            }
        }, 0);
    }

    private setProgress(p: QueueProgress): void {
        this.progress = p;
        this.onProgress(p);
    }
}
