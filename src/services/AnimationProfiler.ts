/**
 * Static, machine-independent cost analysis of a skeleton's animations.
 *
 * Goal: let an animator immediately see *which* animations are expensive and
 * *why*, without having to play them on a fast/slow machine. We inspect the
 * parsed SkeletonData — timelines and attachments — and attribute the known
 * Spine performance drivers (clipping, mesh deforms, non-normal blend modes,
 * draw-order thrash, attachment swaps, constraints) to each animation. The
 * metrics mirror the Spine editor's Metrics view (bones, timelines, vertex
 * transforms, constraints, clipping).
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

/** Detailed analysis of a single clipping (mask) attachment — the costliest Spine feature. */
export interface ClipDetail {
    slot: string;
    vertices: number;        // clip polygon vertex count (fewer = cheaper)
    convex: boolean;         // convex masks are far cheaper to decompose
    clippedSlots: number;    // how many slots fall within the clip range
    clippedTriangles: number; // total triangles the mask must clip each frame
}

export interface AnimationCost {
    name: string;
    duration: number;
    score: number;
    severity: Severity;
    drivers: CostDriver[];
    deformTimelines: number;
    deformedVertices: number;   // "vertex transforms" — heaviest when weighted
    drawOrderKeys: number;
    attachmentSwaps: number;
    boneTimelines: number;
    colorTimelines: number;
    constraintTimelines: number;
    totalTimelines: number;
    clippedSlots: string[];
    blendedSlots: string[];
}

export interface SkeletonCost {
    bones: number;
    slots: number;
    meshes: number;
    meshVertices: number;
    clips: ClipDetail[];
    blendSlots: { slot: string; mode: string }[];
    constraints: { ik: number; transform: number; path: number; physics: number };
}

export interface ProfileResult {
    skeleton: SkeletonCost;
    animations: AnimationCost[]; // sorted heaviest-first
}

const BLEND_MODE_NAMES = ['normal', 'additive', 'multiply', 'screen'];

const W = {
    deformVertex: 0.04,
    deformTimeline: 4,
    drawOrderKey: 1.5,
    attachmentSwap: 2,
    boneTimeline: 0.3,
    constraintTimeline: 1.5,
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

/** Triangle count an attachment contributes when drawn (region = 2, mesh = tris). */
function triangleCount(att: any): number {
    if (!att) return 0;
    if (Array.isArray(att.triangles)) return att.triangles.length / 3; // mesh
    if ('endSlot' in att) return 0;                                     // clipping
    if (att.worldVerticesLength === undefined && att.uvs === undefined && !att.region) {
        return 0; // bounding box / path / point
    }
    return 2; // region attachment
}

/** Is the flat [x,y,x,y,…] polygon convex? Convex clip masks are much cheaper. */
function isConvexPolygon(verts: ArrayLike<number>): boolean {
    const n = verts.length / 2;
    if (n < 4) return true; // triangle is always convex
    let sign = 0;
    for (let i = 0; i < n; i++) {
        const ax = verts[(i * 2) % verts.length];
        const ay = verts[(i * 2 + 1) % verts.length];
        const bx = verts[((i + 1) * 2) % verts.length];
        const by = verts[((i + 1) * 2 + 1) % verts.length];
        const cx = verts[((i + 2) * 2) % verts.length];
        const cy = verts[((i + 2) * 2 + 1) % verts.length];
        const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
        if (cross !== 0) {
            const s = cross > 0 ? 1 : -1;
            if (sign === 0) sign = s;
            else if (s !== sign) return false;
        }
    }
    return true;
}

function analyzeSkeleton(data: any): {
    cost: SkeletonCost;
    clippingSlotIndices: Set<number>;
    blendSlotIndices: Set<number>;
    slotName: (i: number) => string;
} {
    const slots: any[] = data.slots ?? [];
    const slotName = (i: number) => slots[i]?.name ?? `slot${i}`;

    // First-seen attachment per slot across all skins (for triangle counting).
    const attachmentBySlot = new Map<number, any>();
    const skins: any[] = data.skins ?? [];
    const clipAttachments: { slotIndex: number; att: any }[] = [];
    let meshes = 0;
    let meshVertices = 0;

    for (const skin of skins) {
        const entries = typeof skin.getAttachments === 'function' ? skin.getAttachments() : [];
        for (const entry of entries) {
            const att = entry?.attachment;
            if (!att) continue;
            if (!attachmentBySlot.has(entry.slotIndex) && !('endSlot' in att)) {
                attachmentBySlot.set(entry.slotIndex, att);
            }
            if ('endSlot' in att) {
                clipAttachments.push({ slotIndex: entry.slotIndex, att });
            } else if (Array.isArray(att.triangles)) {
                meshes++;
                meshVertices += Math.round((att.worldVerticesLength ?? 0) / 2);
            }
        }
    }

    // Blend modes.
    const blendSlots: { slot: string; mode: string }[] = [];
    const blendSlotIndices = new Set<number>();
    slots.forEach((s, i) => {
        const mode = s?.blendMode ?? 0;
        if (mode !== 0) {
            blendSlots.push({ slot: s.name, mode: BLEND_MODE_NAMES[mode] ?? `mode${mode}` });
            blendSlotIndices.add(i);
        }
    });

    // Detailed clipping analysis.
    const clips: ClipDetail[] = [];
    const clippingSlotIndices = new Set<number>();
    for (const { slotIndex, att } of clipAttachments) {
        clippingSlotIndices.add(slotIndex);
        const verts = att.vertices ?? [];
        const vertexCount = Math.round((att.worldVerticesLength ?? verts.length) / 2);
        const endIndex = att.endSlot?.index ?? slots.length - 1;
        let clippedSlots = 0;
        let clippedTriangles = 0;
        for (let i = slotIndex; i <= endIndex && i < slots.length; i++) {
            clippedSlots++;
            clippedTriangles += triangleCount(attachmentBySlot.get(i));
        }
        clips.push({
            slot: slotName(slotIndex),
            vertices: vertexCount,
            convex: isConvexPolygon(verts),
            clippedSlots,
            clippedTriangles,
        });
    }

    return {
        cost: {
            bones: (data.bones ?? []).length,
            slots: slots.length,
            meshes,
            meshVertices,
            clips,
            blendSlots,
            constraints: {
                ik: (data.ikConstraints ?? []).length,
                transform: (data.transformConstraints ?? []).length,
                path: (data.pathConstraints ?? []).length,
                physics: (data.physicsConstraints ?? []).length,
            },
        },
        clippingSlotIndices,
        blendSlotIndices,
        slotName,
    };
}

type TimelineKind = 'drawOrder' | 'attachment' | 'event' | 'deform' | 'color' | 'bone' | 'constraint';
function classify(t: any): TimelineKind {
    if (Array.isArray(t.drawOrders)) return 'drawOrder';
    if (Array.isArray(t.attachmentNames)) return 'attachment';
    if (Array.isArray(t.events)) return 'event';
    if (t.attachment !== undefined && t.slotIndex !== undefined) return 'deform';
    if (t.slotIndex !== undefined) return 'color';
    if (t.boneIndex !== undefined) return 'bone';
    return 'constraint'; // IK / transform / path / physics / inherit
}

function analyzeAnimation(anim: any, ctx: ReturnType<typeof analyzeSkeleton>): AnimationCost {
    const m = {
        deformTimelines: 0,
        deformedVertices: 0,
        drawOrderKeys: 0,
        attachmentSwaps: 0,
        boneTimelines: 0,
        colorTimelines: 0,
        constraintTimelines: 0,
    };
    const clipped = new Set<string>();
    const blended = new Set<string>();

    const timelines: any[] = anim.timelines ?? [];
    for (const t of timelines) {
        const kind = classify(t);
        const slotIndex: number | undefined = t.slotIndex;
        switch (kind) {
            case 'drawOrder': m.drawOrderKeys += t.drawOrders.length; break;
            case 'attachment': m.attachmentSwaps += t.attachmentNames.filter((n: string | null) => n != null).length; break;
            case 'deform': m.deformTimelines++; m.deformedVertices += Math.round((t.attachment?.worldVerticesLength ?? 0) / 2); break;
            case 'color': m.colorTimelines++; break;
            case 'bone': m.boneTimelines++; break;
            case 'constraint': m.constraintTimelines++; break;
            default: break;
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
        m.constraintTimelines * W.constraintTimeline +
        (touchesClipping ? W.touchesClipping : 0) +
        clippedSlots.length * W.perClippedSlot +
        (touchesBlend ? W.touchesBlend : 0);

    const drivers: CostDriver[] = [];
    if (touchesClipping) {
        drivers.push({ label: `Clipping ×${clippedSlots.length}`, detail: `Clipped slots: ${clippedSlots.join(', ')}`, weight: W.touchesClipping + clippedSlots.length * W.perClippedSlot });
    }
    if (m.deformedVertices > 0) {
        drivers.push({ label: `Mesh deform — ${m.deformedVertices} verts`, detail: `${m.deformTimelines} deform timeline(s)`, weight: m.deformedVertices * W.deformVertex + m.deformTimelines * W.deformTimeline });
    }
    if (m.drawOrderKeys > 0) {
        drivers.push({ label: `Draw-order — ${m.drawOrderKeys} keys`, detail: 'Re-sorts the render order each key (breaks batching)', weight: m.drawOrderKeys * W.drawOrderKey });
    }
    if (touchesBlend) {
        drivers.push({ label: `Blend modes ×${blendedSlots.length}`, detail: `Non-normal blend on: ${blendedSlots.join(', ')}`, weight: W.touchesBlend });
    }
    if (m.constraintTimelines > 0) {
        drivers.push({ label: `Constraints — ${m.constraintTimelines} timeline(s)`, weight: m.constraintTimelines * W.constraintTimeline });
    }
    if (m.attachmentSwaps > 0) {
        drivers.push({ label: `Attachment swaps — ${m.attachmentSwaps}`, weight: m.attachmentSwaps * W.attachmentSwap });
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
        return {
            skeleton: { bones: 0, slots: 0, meshes: 0, meshVertices: 0, clips: [], blendSlots: [], constraints: { ik: 0, transform: 0, path: 0, physics: 0 } },
            animations: [],
        };
    }
    const ctx = analyzeSkeleton(data);
    const animations = data.animations
        .map((a: any) => analyzeAnimation(a, ctx))
        .sort((a: AnimationCost, b: AnimationCost) => b.score - a.score);
    return { skeleton: ctx.cost, animations };
}
