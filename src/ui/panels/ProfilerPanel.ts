import { eventBus } from '../../core/EventBus';
import type { StateManager } from '../../core/StateManager';
import type { SpineManager } from '../../core/SpineManager';
import type { AnimationCost, Severity, SkeletonCost } from '../../services/AnimationProfiler';

const SEVERITY_COLOR: Record<Severity, string> = {
    ok: '#4a9a5a',
    watch: '#c08a30',
    heavy: '#c05050',
};
const SEVERITY_LABEL: Record<Severity, string> = {
    ok: 'OK',
    watch: 'Watch',
    heavy: 'Heavy',
};

/**
 * Right-panel tab: static, machine-independent cost breakdown of every
 * animation, sorted heaviest-first, plus the skeleton's constant overhead.
 * Lets an animator see at a glance which animations are expensive and why.
 */
export class ProfilerPanel {
    element: HTMLElement;
    private summaryEl!: HTMLElement;
    private listEl!: HTMLElement;
    private expanded = new Set<string>();

    constructor(
        private stateManager: StateManager,
        private spineManager: SpineManager,
    ) {
        this.element = document.createElement('div');
        this.build();
        eventBus.on('project:change', () => this.refresh());
    }

    private build(): void {
        const intro = document.createElement('div');
        intro.style.cssText = 'font-size:var(--sv-font-size-sm);color:var(--sv-text-muted);padding:2px 0 8px';
        intro.textContent = 'Static cost analysis — independent of your machine. Click an animation to play it; click the row header to see what drives its cost.';
        this.element.appendChild(intro);

        this.summaryEl = document.createElement('div');
        this.element.appendChild(this.summaryEl);

        const legend = document.createElement('div');
        legend.style.cssText = 'display:flex;gap:12px;padding:6px 0 8px;font-size:var(--sv-font-size-sm);color:var(--sv-text-muted)';
        (['heavy', 'watch', 'ok'] as Severity[]).forEach(sev => {
            const item = document.createElement('span');
            item.style.cssText = 'display:flex;align-items:center;gap:5px';
            const pip = document.createElement('span');
            pip.style.cssText = `width:8px;height:8px;border-radius:2px;background:${SEVERITY_COLOR[sev]}`;
            item.appendChild(pip);
            const lbl = document.createElement('span');
            lbl.textContent = SEVERITY_LABEL[sev];
            item.appendChild(lbl);
            legend.appendChild(item);
        });
        this.element.appendChild(legend);

        this.listEl = document.createElement('div');
        this.element.appendChild(this.listEl);
    }

    refresh(): void {
        this.summaryEl.innerHTML = '';
        this.listEl.innerHTML = '';
        const profile = this.spineManager.profile();
        if (!profile || profile.animations.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText = 'font-size:var(--sv-font-size-sm);color:var(--sv-text-muted);padding:8px 0';
            empty.textContent = 'No skeleton loaded.';
            this.listEl.appendChild(empty);
            return;
        }

        this.renderSummary(profile.skeleton);
        profile.animations.forEach(a => this.renderAnimation(a));
    }

    private renderSummary(s: SkeletonCost): void {
        const card = document.createElement('div');
        card.style.cssText = 'background:var(--sv-bg-secondary);border:1px solid var(--sv-border-light);border-radius:var(--sv-radius);padding:8px 10px;margin-bottom:8px';

        const title = document.createElement('div');
        title.style.cssText = 'font-size:10px;font-weight:600;letter-spacing:0.4px;color:var(--sv-text-muted);margin-bottom:6px';
        title.textContent = 'SKELETON — CONSTANT OVERHEAD';
        card.appendChild(title);

        const grid = document.createElement('div');
        grid.style.cssText = 'display:grid;grid-template-columns:auto 1fr;gap:3px 12px;font-size:var(--sv-font-size-sm)';
        const row = (label: string, value: string, warn = false) => {
            const l = document.createElement('span');
            l.style.color = 'var(--sv-text-muted)';
            l.textContent = label;
            grid.appendChild(l);
            const v = document.createElement('span');
            v.style.cssText = `font-family:var(--sv-font-mono);font-weight:600${warn ? ';color:#c08a30' : ''}`;
            v.textContent = value;
            grid.appendChild(v);
        };
        const c = s.constraints;
        const constraintTotal = c.ik + c.transform + c.path + c.physics;
        row('Bones', String(s.bones), s.bones > 200);
        row('Slots', String(s.slots), s.slots > 300);
        row('Meshes', `${s.meshes} (${s.meshVertices} verts)`);
        row('Constraints', constraintTotal ? `${constraintTotal} (ik ${c.ik}, tf ${c.transform}, path ${c.path}, phys ${c.physics})` : '0', constraintTotal > 20);
        row('Clipping masks', String(s.clips.length), s.clips.length > 0);
        row('Blend modes', s.blendSlots.length ? `${s.blendSlots.length} — ${s.blendSlots.map(b => `${b.slot}:${b.mode}`).join(', ')}` : 'normal only', s.blendSlots.length > 0);
        card.appendChild(grid);

        // Per-mask clipping breakdown — maps directly to Spine's optimization advice.
        if (s.clips.length > 0) {
            const clipWrap = document.createElement('div');
            clipWrap.style.cssText = 'margin-top:8px;display:flex;flex-direction:column;gap:4px';
            s.clips.forEach(clip => {
                const heavy = !clip.convex || clip.vertices > 4 || clip.clippedTriangles > 200;
                const line = document.createElement('div');
                line.style.cssText = `font-size:var(--sv-font-size-sm);${heavy ? 'color:#c08a30' : ''}`;
                const shape = clip.convex ? 'convex' : '⚠ non-convex';
                line.textContent = `◆ ${clip.slot}: ${clip.vertices} verts (${shape}), clips ${clip.clippedSlots} slot(s) / ${clip.clippedTriangles} tris`;
                clipWrap.appendChild(line);
            });
            card.appendChild(clipWrap);

            const note = document.createElement('div');
            note.style.cssText = 'font-size:10px;color:var(--sv-text-muted);margin-top:6px';
            note.textContent = '⚠ Clipping is the most expensive Spine feature (CPU, every frame). Cheapest when the mask is convex, uses few vertices, and clips few triangles.';
            card.appendChild(note);
        }
        this.summaryEl.appendChild(card);
    }

    private renderAnimation(a: AnimationCost): void {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'border-bottom:1px solid var(--sv-border-light)';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 4px;cursor:pointer';

        const pip = document.createElement('span');
        const color = SEVERITY_COLOR[a.severity];
        pip.style.cssText = `width:9px;height:9px;border-radius:2px;flex-shrink:0;border:1px solid ${color};background:${a.severity === 'ok' ? 'transparent' : color}`;
        header.appendChild(pip);

        const name = document.createElement('span');
        name.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--sv-font-size)';
        name.textContent = a.name;
        name.title = `Play ${a.name}`;
        header.appendChild(name);

        const score = document.createElement('span');
        score.style.cssText = `font-family:var(--sv-font-mono);font-size:var(--sv-font-size-sm);font-weight:600;color:${color}`;
        score.textContent = String(a.score);
        header.appendChild(score);

        const caret = document.createElement('span');
        caret.style.cssText = 'color:var(--sv-text-muted);font-size:10px;width:12px;text-align:center';
        const isOpen = this.expanded.has(a.name);
        caret.textContent = isOpen ? '▾' : '▸';
        header.appendChild(caret);

        // Clicking the name plays the animation; clicking elsewhere toggles details.
        name.addEventListener('click', (e) => {
            e.stopPropagation();
            this.spineManager.setAnimation(0, a.name, false);
            this.stateManager.updateProjectA({ currentTrack: 0 });
        });
        header.addEventListener('click', () => {
            if (this.expanded.has(a.name)) this.expanded.delete(a.name);
            else this.expanded.add(a.name);
            this.refresh();
        });
        wrap.appendChild(header);

        if (isOpen) {
            const detail = document.createElement('div');
            detail.style.cssText = 'padding:2px 4px 8px 25px;font-size:var(--sv-font-size-sm);color:var(--sv-text-secondary);display:flex;flex-direction:column;gap:3px';
            if (a.drivers.length === 0) {
                const none = document.createElement('div');
                none.style.color = 'var(--sv-text-muted)';
                none.textContent = 'No notable cost drivers — lightweight animation.';
                detail.appendChild(none);
            } else {
                a.drivers.forEach(d => {
                    const line = document.createElement('div');
                    const strong = document.createElement('strong');
                    strong.textContent = d.label;
                    line.appendChild(strong);
                    if (d.detail) {
                        const det = document.createElement('div');
                        det.style.cssText = 'color:var(--sv-text-muted);font-size:10px';
                        det.textContent = d.detail;
                        line.appendChild(det);
                    }
                    detail.appendChild(line);
                });
            }
            const meta = document.createElement('div');
            meta.style.cssText = 'color:var(--sv-text-muted);font-size:10px;margin-top:2px';
            meta.textContent = `${a.duration.toFixed(2)}s · ${a.totalTimelines} timelines · ${a.boneTimelines} bone · ${a.colorTimelines} color · ${a.constraintTimelines} constraint · ${a.deformedVertices} vtx transforms`;
            detail.appendChild(meta);
            wrap.appendChild(detail);
        }

        this.listEl.appendChild(wrap);
    }
}
