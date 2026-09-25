import { Graphics } from '@electricelephants/pixi-ext';

export interface DebugFlags {
    bones: boolean;
    meshes: boolean;
    boundingBoxes: boolean;
    regions: boolean;
    clipping: boolean;
    paths: boolean;
    origin: boolean;
}

const COLORS = {
    bone: 0xff3b30,
    boneJoint: 0x18d0ff,
    region: 0x3fae4a,
    mesh: 0xff8c1a,
    bounds: 0x4a7fff,
    clipping: 0xc04ad0,
    path: 0x12c2a0,
    origin: 0xff2d95,
};

/**
 * Self-contained skeleton debug overlay. Draws bones and attachment geometry
 * straight from the skeleton's current world vertices via duck-typing — it does
 * NOT use `instanceof` against any spine-core class, so it is immune to the
 * duplicate-runtime-copy problem that makes the bundled SpineDebugRenderer draw
 * only bones (its region/mesh/clipping/path checks fail across module copies).
 *
 * The Graphics is parented to the spine, so skeleton world coordinates map
 * directly into it. Call update() once per frame.
 */
export class SkeletonDebug {
    private g: Graphics;
    private flags: DebugFlags = { bones: false, meshes: false, boundingBoxes: false, regions: false, clipping: false, paths: false, origin: false };
    private buf: number[] = [];

    constructor(private spine: any) {
        this.g = new Graphics();
        this.g.eventMode = 'none';
        spine.addChild(this.g); // children render after the skeleton → on top
    }

    setFlags(f: DebugFlags): void {
        this.flags = { ...f };
    }

    get anyOn(): boolean {
        const f = this.flags;
        return f.bones || f.meshes || f.boundingBoxes || f.regions || f.clipping || f.paths || f.origin;
    }

    destroy(): void {
        this.g.parent?.removeChild(this.g);
        this.g.destroy();
    }

    update(): void {
        const g = this.g;
        g.clear();
        if (!this.anyOn) return;
        const skeleton = this.spine?.skeleton;
        if (!skeleton) return;

        const f = this.flags;
        if (f.regions || f.meshes || f.boundingBoxes || f.clipping || f.paths) {
            const drawOrder: any[] = skeleton.drawOrder ?? skeleton.slots ?? [];
            for (const slot of drawOrder) {
                const att = slot?.attachment;
                if (!att || !slot.bone) continue;
                try {
                    if ('endSlot' in att) {
                        if (f.clipping) this.drawVertexPolygon(slot, att, COLORS.clipping, true);
                    } else if (Array.isArray(att.triangles)) {
                        if (f.meshes) this.drawMesh(slot, att);
                    } else if ('lengths' in att || att.closed !== undefined) {
                        if (f.paths) this.drawVertexPolygon(slot, att, COLORS.path, !!att.closed);
                    } else if (att.worldVerticesLength !== undefined && typeof att.computeWorldVertices === 'function') {
                        // Vertex attachment that isn't mesh/clip/path → bounding box.
                        if (f.boundingBoxes) this.drawVertexPolygon(slot, att, COLORS.bounds, true);
                    } else if (typeof att.computeWorldVertices === 'function') {
                        // Region attachment (4-corner quad, different signature).
                        if (f.regions) this.drawRegion(slot, att);
                    }
                } catch { /* skip attachments that can't resolve this frame */ }
            }
        }

        if (f.bones) this.drawBones(skeleton);
        if (f.origin) this.drawOrigin();
    }

    /**
     * Axis lines through the skeleton origin (the point the game positions the
     * spine by). Line width is compensated for zoom so it stays ~1px on screen.
     */
    private drawOrigin(): void {
        const g = this.g;
        const wt = g.worldTransform;
        const s = Math.hypot(wt.a, wt.b) || 1;
        const px = 1 / s;
        const far = 100000;
        g.lineStyle(px, COLORS.origin, 0.55);
        g.moveTo(-far, 0);
        g.lineTo(far, 0);
        g.moveTo(0, -far);
        g.lineTo(0, far);
        g.lineStyle(1.5 * px, COLORS.origin, 1);
        g.drawCircle(0, 0, 6 * px);
        g.moveTo(-12 * px, 0);
        g.lineTo(12 * px, 0);
        g.moveTo(0, -12 * px);
        g.lineTo(0, 12 * px);
    }

    private drawRegion(slot: any, att: any): void {
        const v = this.buf;
        att.computeWorldVertices(slot, v, 0, 2);
        const g = this.g;
        g.lineStyle(1.5, COLORS.region, 0.9);
        g.moveTo(v[0], v[1]);
        g.lineTo(v[2], v[3]);
        g.lineTo(v[4], v[5]);
        g.lineTo(v[6], v[7]);
        g.lineTo(v[0], v[1]);
    }

    private drawVertexPolygon(slot: any, att: any, color: number, closed: boolean): void {
        const n: number = att.worldVerticesLength;
        if (!n) return;
        const v = this.buf;
        att.computeWorldVertices(slot, 0, n, v, 0, 2);
        const g = this.g;
        g.lineStyle(1.5, color, 0.9);
        g.moveTo(v[0], v[1]);
        for (let i = 2; i < n; i += 2) g.lineTo(v[i], v[i + 1]);
        if (closed) g.lineTo(v[0], v[1]);
    }

    private drawMesh(slot: any, att: any): void {
        const n: number = att.worldVerticesLength;
        const v = this.buf;
        att.computeWorldVertices(slot, 0, n, v, 0, 2);
        const tris: number[] = att.triangles ?? [];
        const g = this.g;
        // Triangle wireframe (faint), then the hull outline (bold).
        g.lineStyle(0.75, COLORS.mesh, 0.45);
        for (let i = 0; i + 2 < tris.length; i += 3) {
            const a = tris[i] * 2, b = tris[i + 1] * 2, c = tris[i + 2] * 2;
            g.moveTo(v[a], v[a + 1]);
            g.lineTo(v[b], v[b + 1]);
            g.lineTo(v[c], v[c + 1]);
            g.lineTo(v[a], v[a + 1]);
        }
        const hull = Math.min(att.hullLength ?? 0, n);
        if (hull >= 6) {
            g.lineStyle(1.5, COLORS.mesh, 0.9);
            g.moveTo(v[0], v[1]);
            for (let i = 2; i < hull; i += 2) g.lineTo(v[i], v[i + 1]);
            g.lineTo(v[0], v[1]);
        }
    }

    private drawBones(skeleton: any): void {
        const g = this.g;
        const bones: any[] = skeleton.bones ?? [];
        for (const bone of bones) {
            const len: number = bone.data?.length ?? 0;
            const x1 = bone.worldX, y1 = bone.worldY;
            if (len > 0) {
                g.lineStyle(2, COLORS.bone, 0.9);
                g.moveTo(x1, y1);
                g.lineTo(x1 + bone.a * len, y1 + bone.c * len);
            }
            g.lineStyle(0);
            g.beginFill(COLORS.boneJoint, 0.95);
            g.drawCircle(x1, y1, 3);
            g.endFill();
        }
    }
}
