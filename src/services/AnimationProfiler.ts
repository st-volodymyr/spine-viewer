/**
 * Static, machine-independent cost analysis of a skeleton's animations.
 *
 * Goal: let an animator immediately see *which* animations are expensive and
 * *why*, without having to play them on a fast/slow machine. We inspect the
 * parsed SkeletonData — timelines and attachments — and attribute the known
 * Spine performance drivers (clipping, mesh deforms, non-normal blend modes,
 * draw-order thrash, attachment swaps) to each animation.
 *
 * Detection is duck-typed on stable runtime property names rather than
 * `instanceof`, so it works across the 4.2 (spine-pixi-v7) and 4.1
 * (pixi-spine) runtimes and survives production minification (property
 * accesses aren't mangled; class names are).
 */

export type Severity = 'ok' | 'watch' | 'heavy';

export interface CostDriver {
    label: string;
    detail?: string;
    weight: number;
}

export interface AnimationCost {
    name: string;
    duration: number;
    score: number;
    severity: Severity;
    drivers: CostDriver[];
    deformTimelines: number;
    deformedVertices: number;
    drawOrderKeys: number;
    attachmentSwaps: number;
    boneTimelines: number;
    colorTimelines: number;
    totalTimelines: number;
    clippedSlots: string[];
    blendedSlots: string[];
}

export interface SkeletonCost {
    bones: number;
    slots: number;
    meshes: number;
    meshVertices: number;
    clippingSlots: string[];
    blendSlots: { slot: string; mode: string }[];
}

export interface ProfileResult {
    skeleton: SkeletonCost;
    animations: AnimationCost[]; // sorted heaviest-first
}

const BLEND_MODE_NAMES = ['normal', 'additive', 'multiply', 'screen'];

// Score weights — tuned so a single clipped slot or a heavy mesh deform pushes
// an animation into "watch", and a combination into "heavy".
const W = {
    deformVertex: 0.04,
    deformTimeline: 4,
    drawOrderKey: 1.5,
    attachmentSwap: 2,
    boneTimeline: 0.3,
    touchesClipping: 35,
    perClippedSlot: 10,
    touchesBlend: 12,
};

const WATCH = 30;
const HEAVY = 80;

function severityFor(score: number): Severity {
    if (score >= HEAVY) return 'heavy';
    if (score >= WATCH) return 'watch';
    return 'ok';
}

/** Build skeleton-level (constant-overhead) cost metrics from all skins. */
function analyzeSkeleton(data: any): {
    cost: SkeletonCost;
    clippingSlotIndices: Set<number>;
    blendSlotIndices: Set<number>;
    slotName: (i: number) => string;
} {
    const slots: any[] = data.slots ?? [];
    const slotName = (i: number) => slots[i]?.name ?? `slot${i}`;

    const blendSlots: { slot: string; mode: string }[] = [];
    const blendSlotIndices = new Set<number>();
    slots.forEach((s, i) => {
        const mode = s?.blendMode ?? 0;
        if (mode !== 0) {
            blendSlots.push({ slot: s.name, mode: BLEND_MODE_NAMES[mode] ?? `mode${mode}` });
            blendSlotIndices.add(i);
        }
    });

    const clippingSlotIndices = new Set<number>();
    const clippingSlots = new Set<string>();
    let meshes = 0;
    let meshVertices = 0;

    const skins: any[] = data.skins ?? [];
    for (const skin of skins) {
        const entries = typeof skin.getAttachments === 'function' ? skin.getAttachments() : [];
        for (const entry of entries) {
            const att = entry?.attachment;
            if (!att) continue;
            // ClippingAttachment uniquely carries `endSlot`.
            if ('endSlot' in att) {
                clippingSlotIndices.add(entry.slotIndex);
                clippingSlots.add(slotName(entry.slotIndex));
            } else if (Array.isArray(att.triangles)) {
                // MeshAttachment.
                meshes++;
                const wvl = att.worldVerticesLength ?? 0;
                meshVertices += Math.round(wvl / 2);
            }
        }
    }

    return {
        cost: {
            bones: (data.bones ?? []).length,
            slots: slots.length,
            meshes,
            meshVertices,
            clippingSlots: [...clippingSlots],
            blendSlots,
        },
        clippingSlotIndices,
        blendSlotIndices,
        slotName,
    };
}

/** Classify one timeline by the stable properties it exposes. */
type TimelineKind = 'drawOrder' | 'attachment' | 'event' | 'deform' | 'color' | 'bone' | 'other';
function classify(t: any): TimelineKind {
    if (Array.isArray(t.drawOrders)) return 'drawOrder';
    if (Array.isArray(t.attachmentNames)) return 'attachment';
    if (Array.isArray(t.events)) return 'event';
    if (t.attachment !== undefined && t.slotIndex !== undefined) return 'deform';
    if (t.slotIndex !== undefined) return 'color';
    if (t.boneIndex !== undefined) return 'bone';
    return 'other';
}

function analyzeAnimation(
    anim: any,
    ctx: ReturnType<typeof analyzeSkeleton>,
): AnimationCost {
    const m = {
        deformTimelines: 0,
        deformedVertices: 0,
        drawOrderKeys: 0,
        attachmentSwaps: 0,
        boneTimelines: 0,
        colorTimelines: 0,
    };
    const clipped = new Set<string>();
    const blended = new Set<string>();

    const timelines: any[] = anim.timelines ?? [];
    for (const t of timelines) {
        const kind = classify(t);
        const slotIndex: number | undefined = t.slotIndex;

        switch (kind) {
            case 'drawOrder':
                m.drawOrderKeys += t.drawOrders.length;
                break;
            case 'attachment':
                m.attachmentSwaps += t.attachmentNames.filter((n: string | null) => n != null).length;
                break;
            case 'deform': {
                m.deformTimelines++;
                const wvl = t.attachment?.worldVerticesLength ?? 0;
                m.deformedVertices += Math.round(wvl / 2);
                break;
            }
            case 'color':
                m.colorTimelines++;
                break;
            case 'bone':
                m.boneTimelines++;
                break;
            default:
                break;
        }

        if (slotIndex !== undefined) {
            if (ctx.clippingSlotIndices.has(slotIndex)) clipped.add(ctx.slotName(slotIndex));
            if (ctx.blendSlotIndices.has(slotIndex)) blended.add(ctx.slotName(slotIndex));
        }
    }

    const clippedSlots = [...clipped];
    const blendedSlots = [...blended];
    const touchesClipping = clippedSlots.length > 0;
    const touchesBlend = blendedSlots.length > 0;

    const score =
        m.deformedVertices * W.deformVertex +
        m.deformTimelines * W.deformTimeline +
        m.drawOrderKeys * W.drawOrderKey +
        m.attachmentSwaps * W.attachmentSwap +
        m.boneTimelines * W.boneTimeline +
        (touchesClipping ? W.touchesClipping : 0) +
        clippedSlots.length * W.perClippedSlot +
        (touchesBlend ? W.touchesBlend : 0);

    // Human-readable breakdown, heaviest contributor first.
    const drivers: CostDriver[] = [];
    if (touchesClipping) {
        drivers.push({
            label: `Clipping ×${clippedSlots.length}`,
            detail: `Clipped slots: ${clippedSlots.join(', ')}`,
            weight: W.touchesClipping + clippedSlots.length * W.perClippedSlot,
        });
    }
    if (m.deformedVertices > 0) {
        drivers.push({
            label: `Mesh deform — ${m.deformedVertices} verts`,
            detail: `${m.deformTimelines} deform timeline(s)`,
            weight: m.deformedVertices * W.deformVertex + m.deformTimelines * W.deformTimeline,
        });
    }
    if (m.drawOrderKeys > 0) {
        drivers.push({
            label: `Draw-order — ${m.drawOrderKeys} keys`,
            detail: 'Re-sorts the render order each key (breaks batching)',
            weight: m.drawOrderKeys * W.drawOrderKey,
        });
    }
    if (touchesBlend) {
        drivers.push({
            label: `Blend modes ×${blendedSlots.length}`,
            detail: `Non-normal blend on: ${blendedSlots.join(', ')}`,
            weight: W.touchesBlend,
        });
    }
    if (m.attachmentSwaps > 0) {
        drivers.push({
            label: `Attachment swaps — ${m.attachmentSwaps}`,
            weight: m.attachmentSwaps * W.attachmentSwap,
        });
    }
    drivers.sort((a, b) => b.weight - a.weight);

    return {
        name: anim.name,
        duration: anim.duration ?? 0,
        score: Math.round(score),
        severity: severityFor(score),
        drivers,
        totalTimelines: timelines.length,
        clippedSlots,
        blendedSlots,
        ...m,
    };
}

export function profileSkeleton(data: any): ProfileResult {
    if (!data || !Array.isArray(data.animations)) {
        return { skeleton: { bones: 0, slots: 0, meshes: 0, meshVertices: 0, clippingSlots: [], blendSlots: [] }, animations: [] };
    }
    const ctx = analyzeSkeleton(data);
    const animations = data.animations
        .map((a: any) => analyzeAnimation(a, ctx))
        .sort((a: AnimationCost, b: AnimationCost) => b.score - a.score);
    return { skeleton: ctx.cost, animations };
}
