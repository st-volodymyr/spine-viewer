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
