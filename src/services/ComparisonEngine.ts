import type { SpineManager } from '../core/SpineManager';
import type { ComparisonDiff, StructuredDiff, AnimationDiffEntry } from '../types/state';

/** One attachment entry, keyed by "slot / attachmentName", with its atlas region + type. */
interface AttachmentInfo { region: string; type: string }

export interface ReskinMismatch {
    key: string;
    regionDiffers: boolean;
    typeDiffers: boolean;
    a: AttachmentInfo;
    b: AttachmentInfo;
}

export interface ReskinDiff {
    onlyA: string[];          // attachments present in A but missing in B (or vice-versa)
    onlyB: string[];
    mismatches: ReskinMismatch[]; // same slot+attachment, different region or type
    matched: number;
}

function attachmentType(att: any): string {
    if ('endSlot' in att) return 'clipping';
    if (Array.isArray(att.triangles)) return 'mesh';
    if (Array.isArray(att.lengths) || att.closed !== undefined) return 'path';
    if (att.uvs !== undefined || att.region !== undefined || att.width !== undefined) return 'region';
    return 'other';
}

/** Aggregate every skin's attachments for a skeleton, keyed by "slot / attachment". */
function collectAttachments(data: any): Map<string, AttachmentInfo> {
    const map = new Map<string, AttachmentInfo>();
    if (!data) return map;
    const slots: any[] = data.slots ?? [];
    const slotName = (i: number) => slots[i]?.name ?? `slot${i}`;
    for (const skin of data.skins ?? []) {
        const entries = typeof skin.getAttachments === 'function' ? skin.getAttachments() : [];
        for (const e of entries) {
            const att = e?.attachment;
            if (!att) continue;
            const key = `${slotName(e.slotIndex)} / ${e.name}`;
            if (map.has(key)) continue;
            map.set(key, { region: att.path ?? att.name ?? e.name, type: attachmentType(att) });
        }
    }
    return map;
}


// ---------------------------------------------------------------------------
// Deep diff: animation durations, event timing, constraints, slot setup.
// All readers duck-type the runtime SkeletonData (4.1 pixi-spine and 4.2
// spine-core share field names) — no instanceof.
// ---------------------------------------------------------------------------

/** One frame at 30 fps, in seconds — duration deltas above this are flagged. */
export const FRAME_30 = 1 / 30;
const TIME_EPS = 0.001;   // 1 ms — event time tolerance
const NUM_EPS = 1e-4;     // generic numeric tolerance for setup params

export interface DurationDelta {
    name: string;
    a: number;        // seconds
    b: number;        // seconds
    delta: number;    // b - a, seconds
    flagged: boolean; // |delta| > 1 frame @30fps
}

export interface DurationDiff {
    shared: number;
    changed: DurationDelta[]; // only animations whose duration differs at all (> ~0.5 ms)
    flagged: number;
}

export interface EventKey {
    name: string;
    index: number;   // occurrence index of this name within the animation (time-sorted)
    time: number;
    int: number;
    float: number;
    string: string;
}

export interface EventKeyChange {
    kind: 'only-a' | 'only-b' | 'changed';
    name: string;
    index: number;
    a?: EventKey;
    b?: EventKey;
    changes: string[]; // human-readable ("time 0.500s → 0.533s (+33ms)", "int 1 → 2")
}

export interface AnimEventDiff { anim: string; keysA: number; keysB: number; changes: EventKeyChange[] }

export interface EventTimingDiff {
    animsCompared: number;
    keysCompared: number;   // keys matched by name+index on both sides
    anims: AnimEventDiff[]; // only animations with at least one change
    issues: number;
}

export type ConstraintKind = 'ik' | 'transform' | 'path' | 'physics';
export interface ConstraintRef { kind: ConstraintKind; name: string }
export interface ConstraintChange extends ConstraintRef { changes: string[] }
export interface ConstraintDiff {
    onlyA: ConstraintRef[];
    onlyB: ConstraintRef[];
    changed: ConstraintChange[];
    matched: number;
}

export interface SlotSetupChange { slot: string; changes: string[] }
export interface SlotSetupDiff { shared: number; changed: SlotSetupChange[] }

const CONSTRAINT_LISTS: [ConstraintKind, string][] = [
    ['ik', 'ikConstraints'],
    ['transform', 'transformConstraints'],
    ['path', 'pathConstraints'],
    ['physics', 'physicsConstraints'],
];
/** Fields that are identity/bookkeeping, not setup parameters. */
const CONSTRAINT_SKIP = new Set(['name', 'order', 'index']);

const fmtS = (s: number) => `${s.toFixed(3)}s`;
const fmtMs = (s: number) => `${s >= 0 ? '+' : ''}${Math.round(s * 1000)}ms`;
const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : String(+n.toFixed(4)));
const numDiff = (a: number, b: number) => Math.abs(a - b) > NUM_EPS;

function byName(list: any[] | undefined): Map<string, any> {
    const m = new Map<string, any>();
    for (const item of list ?? []) if (item?.name != null && !m.has(item.name)) m.set(item.name, item);
    return m;
}

/** Normalize a constraint field to a comparable primitive (bones/targets → names). */
function normField(v: any): string | number | boolean | undefined {
    if (v == null) return undefined;
    const t = typeof v;
    if (t === 'number' || t === 'boolean' || t === 'string') return v;
    if (Array.isArray(v)) {
        if (v.every(x => x && typeof x === 'object' && 'name' in x)) return v.map(x => x.name).join(', ');
        return undefined;
    }
    if (t === 'object' && typeof v.name === 'string') return v.name;
    return undefined;
}

function constraintChanges(a: any, b: any): string[] {
    const out: string[] = [];
    // 4.2 stores target/bone behind getters (`_target`, `_bone`) — strip the
    // underscore so we read the public accessor (and dedupe with it).
    const keys = new Set<string>([...Object.keys(a), ...Object.keys(b)].map(k => k.replace(/^_/, '')));
    const show = (v: any) => (v === undefined ? '—' : typeof v === 'number' ? fmtNum(v) : String(v));
    for (const k of [...keys].sort()) {
        if (CONSTRAINT_SKIP.has(k)) continue;
        const va = normField(a[k]);
        const vb = normField(b[k]);
        if (va === undefined && vb === undefined) continue;
        if (typeof va === 'number' && typeof vb === 'number') {
            if (numDiff(va, vb)) out.push(`${k}: ${fmtNum(va)} → ${fmtNum(vb)}`);
        } else if (va !== vb) {
            out.push(`${k}: ${show(va)} → ${show(vb)}`);
        }
    }
    return out;
}

/** Collect an animation's event keys, time-sorted, each tagged with its per-name occurrence index. */
function collectEventKeys(anim: any): EventKey[] {
    const raw: any[] = [];
    for (const tl of anim?.timelines ?? []) {
        if (tl && Array.isArray(tl.events)) raw.push(...tl.events.filter(Boolean));
    }
    raw.sort((x, y) => (x.time ?? 0) - (y.time ?? 0));
    const counts = new Map<string, number>();
    return raw.map(ev => {
        const name: string = ev.data?.name ?? ev.name ?? '?';
        const index = counts.get(name) ?? 0;
        counts.set(name, index + 1);
        return {
            name, index,
            time: ev.time ?? 0,
            int: ev.intValue ?? 0,
            float: ev.floatValue ?? 0,
            string: ev.stringValue ?? '',
        };
    });
}

function colorHex(c: any): string | null {
    if (!c) return null;
    const h = (v: number) => Math.round(Math.max(0, Math.min(1, v ?? 0)) * 255).toString(16).padStart(2, '0');
    return `${h(c.r)}${h(c.g)}${h(c.b)}${h(c.a ?? 1)}`;
}

const BLEND_NAMES = ['normal', 'additive', 'multiply', 'screen'];
const blendName = (v: any) => (typeof v === 'number' ? BLEND_NAMES[v] ?? String(v) : String(v ?? 'normal'));

/** Pure: duration deltas for animations present in both skeletons. */
export function diffDurations(dataA: any, dataB: any): DurationDiff {
    const a = byName(dataA?.animations);
    const b = byName(dataB?.animations);
    const changed: DurationDelta[] = [];
    let shared = 0;
    for (const [name, animA] of a) {
        const animB = b.get(name);
        if (!animB) continue;
        shared++;
        const da = animA.duration ?? 0;
        const db = animB.duration ?? 0;
        const delta = db - da;
        if (Math.abs(delta) > 0.0005) {
            changed.push({ name, a: da, b: db, delta, flagged: Math.abs(delta) > FRAME_30 + 1e-6 });
        }
    }
    changed.sort((x, y) => Number(y.flagged) - Number(x.flagged) || Math.abs(y.delta) - Math.abs(x.delta) || x.name.localeCompare(y.name));
    return { shared, changed, flagged: changed.filter(c => c.flagged).length };
}

/** Pure: event key timing/value diff for animations present in both skeletons. */
export function diffEventTiming(dataA: any, dataB: any): EventTimingDiff {
    const a = byName(dataA?.animations);
    const b = byName(dataB?.animations);
    const anims: AnimEventDiff[] = [];
    let animsCompared = 0, keysCompared = 0, issues = 0;
    const id = (k: EventKey) => `${k.name}#${k.index}`;

    for (const [name, animA] of a) {
        const animB = b.get(name);
        if (!animB) continue;
        const keysA = collectEventKeys(animA);
        const keysB = collectEventKeys(animB);
        if (!keysA.length && !keysB.length) continue;
        animsCompared++;

        const mapB = new Map(keysB.map(k => [id(k), k]));
        const seen = new Set<string>();
        const changes: EventKeyChange[] = [];

        for (const ka of keysA) {
            const kb = mapB.get(id(ka));
            if (!kb) { changes.push({ kind: 'only-a', name: ka.name, index: ka.index, a: ka, changes: [] }); continue; }
            seen.add(id(ka));
            keysCompared++;
            const diffs: string[] = [];
            if (Math.abs(ka.time - kb.time) > TIME_EPS) diffs.push(`time ${fmtS(ka.time)} → ${fmtS(kb.time)} (${fmtMs(kb.time - ka.time)})`);
            if (ka.int !== kb.int) diffs.push(`int ${ka.int} → ${kb.int}`);
            if (numDiff(ka.float, kb.float)) diffs.push(`float ${fmtNum(ka.float)} → ${fmtNum(kb.float)}`);
            if (ka.string !== kb.string) diffs.push(`string "${ka.string}" → "${kb.string}"`);
            if (diffs.length) changes.push({ kind: 'changed', name: ka.name, index: ka.index, a: ka, b: kb, changes: diffs });
        }
        for (const kb of keysB) {
            if (!seen.has(id(kb))) changes.push({ kind: 'only-b', name: kb.name, index: kb.index, b: kb, changes: [] });
        }

        if (changes.length) {
            const t = (c: EventKeyChange) => (c.a ?? c.b)!.time;
            changes.sort((x, y) => t(x) - t(y) || x.name.localeCompare(y.name));
            anims.push({ anim: name, keysA: keysA.length, keysB: keysB.length, changes });
            issues += changes.length;
        }
    }
    anims.sort((x, y) => x.anim.localeCompare(y.anim));
    return { animsCompared, keysCompared, anims, issues };
}

/** Pure: IK / transform / path / physics constraint diff. */
export function diffConstraints(dataA: any, dataB: any): ConstraintDiff {
    const onlyA: ConstraintRef[] = [];
    const onlyB: ConstraintRef[] = [];
    const changed: ConstraintChange[] = [];
    let matched = 0;
    for (const [kind, field] of CONSTRAINT_LISTS) {
        const a = byName(dataA?.[field]);
        const b = byName(dataB?.[field]);
        for (const [name, ca] of a) {
            const cb = b.get(name);
            if (!cb) { onlyA.push({ kind, name }); continue; }
            const changes = constraintChanges(ca, cb);
            if (changes.length) changed.push({ kind, name, changes });
            else matched++;
        }
        for (const name of b.keys()) if (!a.has(name)) onlyB.push({ kind, name });
    }
    const cmp = (x: ConstraintRef, y: ConstraintRef) => x.kind.localeCompare(y.kind) || x.name.localeCompare(y.name);
    onlyA.sort(cmp); onlyB.sort(cmp); changed.sort(cmp);
    return { onlyA, onlyB, changed, matched };
}

/** Pure: setup-pose slot changes (attachment, color, dark color, blend mode, parent bone). */
export function diffSlotSetup(dataA: any, dataB: any): SlotSetupDiff {
    const a = byName(dataA?.slots);
    const b = byName(dataB?.slots);
    const changed: SlotSetupChange[] = [];
    let shared = 0;
    for (const [name, sa] of a) {
        const sb = b.get(name);
        if (!sb) continue;
        shared++;
        const changes: string[] = [];
        const attA = sa.attachmentName ?? null;
        const attB = sb.attachmentName ?? null;
        if (attA !== attB) changes.push(`attachment: ${attA ?? '(none)'} → ${attB ?? '(none)'}`);
        const colA = colorHex(sa.color), colB = colorHex(sb.color);
        if (colA !== colB) changes.push(`color: #${colA ?? '—'} → #${colB ?? '—'}`);
        const darkA = colorHex(sa.darkColor), darkB = colorHex(sb.darkColor);
        if (darkA !== darkB) changes.push(`dark: ${darkA ? '#' + darkA : 'off'} → ${darkB ? '#' + darkB : 'off'}`);
        const blA = blendName(sa.blendMode), blB = blendName(sb.blendMode);
        if (blA !== blB) changes.push(`blend: ${blA} → ${blB}`);
        const boneA = sa.boneData?.name, boneB = sb.boneData?.name;
        if (boneA !== boneB) changes.push(`bone: ${boneA ?? '—'} → ${boneB ?? '—'}`);
        if (changes.length) changed.push({ slot: name, changes });
    }
    changed.sort((x, y) => x.slot.localeCompare(y.slot));
    return { shared, changed };
}

export class ComparisonEngine {
    private managers: SpineManager[] = [];
    syncEnabled = true;

    setManagers(managers: SpineManager[]): void {
        this.managers = managers;
    }

    syncAnimation(sourceIdx: number, animName: string, track: number, loop: boolean): void {
        if (!this.syncEnabled) return;
        this.managers.forEach((mgr, idx) => {
            if (idx !== sourceIdx && mgr.getAnimationNames().includes(animName)) {
                mgr.setAnimation(track, animName, loop);
            }
        });
    }

    syncSkin(sourceIdx: number, skinName: string): void {
        if (!this.syncEnabled) return;
        this.managers.forEach((mgr, idx) => {
            if (idx !== sourceIdx && mgr.getSkinNames().includes(skinName)) {
                mgr.setSkin(skinName);
            }
        });
    }

    syncSpeed(sourceIdx: number, speed: number): void {
        if (!this.syncEnabled) return;
        this.managers.forEach((mgr, idx) => {
            if (idx !== sourceIdx) mgr.setSpeed(speed);
        });
    }

    syncPause(sourceIdx: number, paused: boolean): void {
        if (!this.syncEnabled) return;
        this.managers.forEach((mgr, idx) => {
            if (idx !== sourceIdx) mgr.setPaused(paused);
        });
    }

    getDiff(idxA: number, idxB: number): ComparisonDiff {
        const mgrA = this.managers[idxA];
        const mgrB = this.managers[idxB];
        if (!mgrA || !mgrB) {
            return emptyDiff();
        }

        const animsA = new Set(mgrA.getAnimationNames());
        const animsB = new Set(mgrB.getAnimationNames());
        const skinsA = new Set(mgrA.getSkinNames());
        const skinsB = new Set(mgrB.getSkinNames());
        const slotsA = new Set(mgrA.getSlotNames());
        const slotsB = new Set(mgrB.getSlotNames());
        const bonesA = new Set(mgrA.getBoneNames());
        const bonesB = new Set(mgrB.getBoneNames());
        const eventsA = new Set(mgrA.getEventNames());
        const eventsB = new Set(mgrB.getEventNames());

        return {
            animationsOnlyA: [...animsA].filter(a => !animsB.has(a)),
            animationsOnlyB: [...animsB].filter(a => !animsA.has(a)),
            animationsShared: [...animsA].filter(a => animsB.has(a)),
            skinsOnlyA: [...skinsA].filter(s => !skinsB.has(s)),
            skinsOnlyB: [...skinsB].filter(s => !skinsA.has(s)),
            skinsShared: [...skinsA].filter(s => skinsB.has(s)),
            slotsOnlyA: [...slotsA].filter(s => !slotsB.has(s)),
            slotsOnlyB: [...slotsB].filter(s => !slotsA.has(s)),
            bonesOnlyA: [...bonesA].filter(b => !bonesB.has(b)),
            bonesOnlyB: [...bonesB].filter(b => !bonesA.has(b)),
            eventsOnlyA: [...eventsA].filter(e => !eventsB.has(e)),
            eventsOnlyB: [...eventsB].filter(e => !eventsA.has(e)),
            eventsShared: [...eventsA].filter(e => eventsB.has(e)),
        };
    }

    getStructuredDiff(idxA: number, idxB: number): StructuredDiff {
        const mgrA = this.managers[idxA];
        const mgrB = this.managers[idxB];
        if (!mgrA || !mgrB) {
            return emptyStructuredDiff();
        }

        const diff = this.getDiff(idxA, idxB);
        const animations: AnimationDiffEntry[] = [];

        for (const name of diff.animationsShared) {
            animations.push({
                name,
                status: 'shared',
                durationA: mgrA.getAnimationDuration(name) ?? undefined,
                durationB: mgrB.getAnimationDuration(name) ?? undefined,
            });
        }
        for (const name of diff.animationsOnlyA) {
            animations.push({
                name,
                status: 'only-a',
                durationA: mgrA.getAnimationDuration(name) ?? undefined,
            });
        }
        for (const name of diff.animationsOnlyB) {
            animations.push({
                name,
                status: 'only-b',
                durationB: mgrB.getAnimationDuration(name) ?? undefined,
            });
        }

        animations.sort((a, b) => {
            const order = { 'shared': 0, 'only-a': 1, 'only-b': 2 };
            return order[a.status] - order[b.status] || a.name.localeCompare(b.name);
        });

        return {
            animations,
            summary: {
                bonesA: mgrA.getBoneNames().length,
                bonesB: mgrB.getBoneNames().length,
                slotsA: mgrA.getSlotNames().length,
                slotsB: mgrB.getSlotNames().length,
                skinsA: mgrA.getSkinNames().length,
                skinsB: mgrB.getSkinNames().length,
                eventsA: mgrA.getEventNames().length,
                eventsB: mgrB.getEventNames().length,
                animsShared: diff.animationsShared.length,
                animsOnlyA: diff.animationsOnlyA.length,
                animsOnlyB: diff.animationsOnlyB.length,
            },
            skinsOnlyA: diff.skinsOnlyA,
            skinsOnlyB: diff.skinsOnlyB,
            skinsShared: diff.skinsShared,
            bonesOnlyA: diff.bonesOnlyA,
            bonesOnlyB: diff.bonesOnlyB,
            slotsOnlyA: diff.slotsOnlyA,
            slotsOnlyB: diff.slotsOnlyB,
            eventsOnlyA: diff.eventsOnlyA,
            eventsOnlyB: diff.eventsOnlyB,
            eventsShared: diff.eventsShared,
        };
    }

    /**
     * Attachment-level "reskin" audit between two projects: which attachments are
     * missing on either side, and which share a slot+name but resolve to a
     * different atlas region or attachment type.
     */
    getReskinDiff(idxA: number, idxB: number): ReskinDiff {
        const mgrA = this.managers[idxA];
        const mgrB = this.managers[idxB];
        if (!mgrA || !mgrB) return { onlyA: [], onlyB: [], mismatches: [], matched: 0 };

        const a = collectAttachments(mgrA.spineData);
        const b = collectAttachments(mgrB.spineData);

        const onlyA: string[] = [];
        const onlyB: string[] = [];
        const mismatches: ReskinMismatch[] = [];
        let matched = 0;

        for (const [key, infoA] of a) {
            const infoB = b.get(key);
            if (!infoB) { onlyA.push(key); continue; }
            const regionDiffers = infoA.region !== infoB.region;
            const typeDiffers = infoA.type !== infoB.type;
            if (regionDiffers || typeDiffers) mismatches.push({ key, regionDiffers, typeDiffers, a: infoA, b: infoB });
            else matched++;
        }
        for (const key of b.keys()) {
            if (!a.has(key)) onlyB.push(key);
        }

        onlyA.sort(); onlyB.sort();
        mismatches.sort((x, y) => x.key.localeCompare(y.key));
        return { onlyA, onlyB, mismatches, matched };
    }

    private dataPair(idxA: number, idxB: number): [any, any] | null {
        const a = this.managers[idxA]?.spineData;
        const b = this.managers[idxB]?.spineData;
        return a && b ? [a, b] : null;
    }

    getDurationDiff(idxA: number, idxB: number): DurationDiff {
        const p = this.dataPair(idxA, idxB);
        return p ? diffDurations(p[0], p[1]) : { shared: 0, changed: [], flagged: 0 };
    }

    getEventTimingDiff(idxA: number, idxB: number): EventTimingDiff {
        const p = this.dataPair(idxA, idxB);
        return p ? diffEventTiming(p[0], p[1]) : { animsCompared: 0, keysCompared: 0, anims: [], issues: 0 };
    }

    getConstraintDiff(idxA: number, idxB: number): ConstraintDiff {
        const p = this.dataPair(idxA, idxB);
        return p ? diffConstraints(p[0], p[1]) : { onlyA: [], onlyB: [], changed: [], matched: 0 };
    }

    getSlotSetupDiff(idxA: number, idxB: number): SlotSetupDiff {
        const p = this.dataPair(idxA, idxB);
        return p ? diffSlotSetup(p[0], p[1]) : { shared: 0, changed: [] };
    }

    getFullDiffSummary(): string {
        if (this.managers.length < 2) return '';

        const lines: string[] = [];
        for (let i = 0; i < this.managers.length; i++) {
            for (let j = i + 1; j < this.managers.length; j++) {
                const diff = this.getDiff(i, j);
                lines.push(`--- Project ${i + 1} vs Project ${j + 1} ---`);
                if (diff.animationsOnlyA.length) lines.push(`Animations only in ${i + 1}: ${diff.animationsOnlyA.join(', ')}`);
                if (diff.animationsOnlyB.length) lines.push(`Animations only in ${j + 1}: ${diff.animationsOnlyB.join(', ')}`);
                lines.push(`Shared animations: ${diff.animationsShared.length}`);
                if (diff.skinsOnlyA.length) lines.push(`Skins only in ${i + 1}: ${diff.skinsOnlyA.join(', ')}`);
                if (diff.skinsOnlyB.length) lines.push(`Skins only in ${j + 1}: ${diff.skinsOnlyB.join(', ')}`);
                lines.push(`Shared skins: ${diff.skinsShared.length}`);
                lines.push('');
            }
        }
        return lines.join('\n');
    }
}

function emptyDiff(): ComparisonDiff {
    return {
        animationsOnlyA: [], animationsOnlyB: [], animationsShared: [],
        skinsOnlyA: [], skinsOnlyB: [], skinsShared: [],
        slotsOnlyA: [], slotsOnlyB: [],
        bonesOnlyA: [], bonesOnlyB: [],
        eventsOnlyA: [], eventsOnlyB: [], eventsShared: [],
    };
}

function emptyStructuredDiff(): StructuredDiff {
    return {
        animations: [],
        summary: {
            bonesA: 0, bonesB: 0, slotsA: 0, slotsB: 0,
            skinsA: 0, skinsB: 0, eventsA: 0, eventsB: 0,
            animsShared: 0, animsOnlyA: 0, animsOnlyB: 0,
        },
        skinsOnlyA: [], skinsOnlyB: [], skinsShared: [],
        bonesOnlyA: [], bonesOnlyB: [],
        slotsOnlyA: [], slotsOnlyB: [],
        eventsOnlyA: [], eventsOnlyB: [], eventsShared: [],
    };
}
