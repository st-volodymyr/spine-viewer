import { eventBus } from '../../core/EventBus';
import { Container, Graphics, Matrix, Sprite, Text, Texture } from '@electricelephants/pixi-ext';
import { SpineElement } from '@electricelephants/pixi-ext';
import { Spine as Spine41 } from '@pixi-spine/all-4.1';
import type { SpineManager } from '../../core/SpineManager';
import type { StateManager } from '../../core/StateManager';
import { loadSpineFiles, createFileInput } from '../../services/FileLoader';
import { parseSpineFiles, clearSpineCache } from '../../services/SpineParser';
import { detectSpineVersion } from '../../services/SpineVersionDetector';

const MARKER_SIZE = 12;
const MARKER_LABEL = 'sv-marker-label';
const NUM_INPUT_CSS = 'width:52px;padding:1px 4px;border:1px solid var(--sv-border);border-radius:var(--sv-radius);background:var(--sv-bg-input);color:var(--sv-text-primary);font-size:var(--sv-font-size-sm)';

type AnySpine = SpineElement | Spine41;

/** A second skeleton placed into a slot (like a symbol inside a win frame). */
interface ChildSpine {
    spine: AnySpine;
    cacheKey: string | null;  // pixi-ext Cache key (4.2 only), cleared on removal
    name: string;
}

interface PlaceholderEntry {
    slotName: string;
    marker: Graphics | null;
    // anchor follows the slot: inside pixi-ext's slot container (bone transform + draw
    // order for free), or — 4.1 runtime, whose slot containers hide while the slot is
    // empty — a spine child whose transform the follow-loop copies from the bone.
    anchor: Container | null;
    followBone: boolean;
    adjust: Container | null;     // user offset/scale inside the anchor; parents the content
    content: Sprite | Text | AnySpine | null;
    child: ChildSpine | null;
    offsetX: number;
    offsetY: number;
    scale: number;
    sync: boolean;                // child spine mirrors the parent's pause + speed
}

type Entries = Map<string, PlaceholderEntry>;

type SlotStatus = {
    accessible: boolean;   // bone exists and not scaled to zero in setup pose
    alphaZero: boolean;    // slot color alpha is explicitly 0 in setup
    hasSetupAttachment: boolean;
    resolvable: boolean;
    setupAttachmentName: string | null;
    reason: string;        // diagnostic detail when not accessible
};

interface CompareProjectRef {
    name: string;
    manager: SpineManager;
}

export class PlaceholderPanel {
    element: HTMLElement;
    private listEl!: HTMLElement;
    private showAllToggle!: HTMLInputElement;
    private searchInput!: HTMLInputElement;
    private searchTerm = '';
    private managerIds = new Map<SpineManager, string>();
    private managerIdSeq = 0;

    // Single-mode entries
    private entries: Entries = new Map();

    // Compare-mode: per-project entries, preserved across refreshes
    private compareEntries: Map<SpineManager, Entries> = new Map();
    private compareProjects: CompareProjectRef[] = [];
    private isCompareMode = false;

    // Single shared rAF loop that follows every marker/floating-content to its
    // slot bone — replaces the previous one-rAF-chain-per-marker approach.
    private tickHandle: number | null = null;

    constructor(
        private stateManager: StateManager,
        private spineManager: SpineManager,
    ) {
        this.element = document.createElement('div');
        this.build();

        eventBus.on('project:change', () => this.refresh());
        eventBus.on('project:update', () => this.refreshStatuses());
        eventBus.on('mode:change', (mode: string) => {
            this.isCompareMode = mode === 'comparison';
            this.refresh();
        });
        eventBus.on('comparison:projects-changed', (projects: CompareProjectRef[]) => {
            // Prune entries for removed projects
            const managers = new Set(projects.map(p => p.manager));
            for (const mgr of this.compareEntries.keys()) {
                if (!managers.has(mgr)) {
                    this.clearEntriesMap(this.compareEntries.get(mgr)!);
                    this.compareEntries.delete(mgr);
                }
            }
            this.compareProjects = projects;
            if (this.isCompareMode) this.refresh();
        });
    }

    private getProjectEntries(manager: SpineManager): Entries {
        if (!this.compareEntries.has(manager)) {
            this.compareEntries.set(manager, new Map());
        }
        return this.compareEntries.get(manager)!;
    }

    private build(): void {
        const header = document.createElement('div');
        header.className = 'sv-control-row';
        header.style.padding = '4px 0';

        const label = document.createElement('span');
        label.className = 'sv-control-label';
        label.textContent = 'Show All';
        header.appendChild(label);

        const toggleLabel = document.createElement('label');
        toggleLabel.className = 'sv-toggle';
        this.showAllToggle = document.createElement('input');
        this.showAllToggle.type = 'checkbox';
        this.showAllToggle.addEventListener('change', () => this.toggleAll());
        const track = document.createElement('span');
        track.className = 'sv-toggle-track';
        toggleLabel.appendChild(this.showAllToggle);
        toggleLabel.appendChild(track);
        header.appendChild(toggleLabel);

        this.element.appendChild(header);

        const info = document.createElement('div');
        info.style.fontSize = 'var(--sv-font-size-sm)';
        info.style.color = 'var(--sv-text-muted)';
        info.style.padding = '2px 0 6px';
        info.textContent = 'Toggle a slot to show its marker. Put a label, an image or another spine into the slot — it follows the slot’s bone, with its own offset/scale.';
        this.element.appendChild(info);

        const legend = document.createElement('div');
        legend.style.cssText = 'font-size:var(--sv-font-size-sm);color:var(--sv-text-muted);padding:2px 0 6px;display:flex;flex-direction:column;gap:2px';
        const legendItems: Array<[string, string, string]> = [
            ['\u25CF', '#4caf50', 'accessible + has a resolvable setup attachment'],
            ['\u25CB', '#4caf50', 'accessible + empty in setup pose (placeholder ready for content)'],
            ['\u26A0', '#e0a020', 'has a setup attachment but it\u2019s not found in the current skin'],
            ['\u2715', '#e05050', 'not accessible (ancestor bone scaled to 0, or slot alpha 0)'],
        ];
        legendItems.forEach(([icon, color, text]) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:6px';
            const ic = document.createElement('span');
            ic.textContent = icon;
            ic.style.cssText = `color:${color};width:14px;text-align:center;font-size:10px`;
            const tx = document.createElement('span');
            tx.textContent = text;
            row.appendChild(ic);
            row.appendChild(tx);
            legend.appendChild(row);
        });
        this.element.appendChild(legend);

        const searchRow = document.createElement('div');
        searchRow.style.cssText = 'display:flex;gap:4px;align-items:center;padding:2px 0 6px';
        this.searchInput = document.createElement('input');
        this.searchInput.type = 'search';
        this.searchInput.placeholder = 'Filter slots\u2026';
        this.searchInput.style.cssText = 'flex:1;padding:2px 6px;border:1px solid var(--sv-border);border-radius:var(--sv-radius);background:var(--sv-bg-input);color:var(--sv-text-primary);font-size:var(--sv-font-size-sm)';
        this.searchInput.addEventListener('input', () => {
            this.searchTerm = this.searchInput.value.trim().toLowerCase();
            this.applyFilter();
        });
        searchRow.appendChild(this.searchInput);
        this.element.appendChild(searchRow);

        this.listEl = document.createElement('div');
        this.element.appendChild(this.listEl);
    }

    refresh(): void {
        // In single mode: destroy all visuals and rebuild the list
        // In compare mode: only rebuild DOM; keep compare entries (and their visuals) intact
        if (this.isCompareMode) {
            this.listEl.innerHTML = '';
            if (this.compareProjects.length === 0) return;
            this.compareProjects.forEach(project => {
                const entries = this.getProjectEntries(project.manager);
                this.buildProjectSection(project.name, project.manager, entries);
            });
            // Re-apply show-all for any newly added projects that don't have markers yet
            if (this.showAllToggle.checked) this.toggleAll();
        } else {
            this.clearEntriesMap(this.entries);
            this.entries = new Map();
            this.listEl.innerHTML = '';
            const slotNames = this.stateManager.projectA?.slotNames ?? [];
            slotNames.forEach(slotName => this.buildSlotRow(slotName, this.spineManager, this.entries, this.listEl));
        }
        this.applyFilter();
    }

    private managerId(manager: SpineManager): string {
        let id = this.managerIds.get(manager);
        if (!id) {
            id = `m${this.managerIdSeq++}`;
            this.managerIds.set(manager, id);
        }
        return id;
    }

    private managerById(id: string): SpineManager | null {
        for (const [mgr, mid] of this.managerIds) if (mid === id) return mgr;
        return null;
    }

    private computeSlotStatus(slotName: string, manager: SpineManager): SlotStatus | null {
        const spine = manager.spine;
        if (!spine) return null;
        const skeleton: any = spine.skeleton;
        const slot = skeleton.findSlot(slotName);
        if (!slot) return null;
        const data = slot.data;
        const setupAttachmentName: string | null = data.attachmentName ?? null;
        const hasSetupAttachment = !!setupAttachmentName;
        let resolvable = false;
        if (hasSetupAttachment) {
            try {
                const att = skeleton.getAttachment(data.index, setupAttachmentName);
                resolvable = !!att;
            } catch { resolvable = false; }
        }
        const rawAlpha = data.color?.a;
        const alphaZero = typeof rawAlpha === 'number' && rawAlpha === 0;
        // Walk the bone's setup-pose ancestry; if any bone has setup scale 0, the
        // slot would render at an unreachable point.
        let accessible = true;
        let reason = '';
        const bone = slot.bone;
        if (!bone) { accessible = false; reason = 'slot has no bone'; }
        else {
            let b: any = bone;
            while (b) {
                const bd = b.data;
                if (bd && (bd.scaleX === 0 || bd.scaleY === 0)) {
                    accessible = false;
                    reason = `bone "${bd.name}" has setup scale 0`;
                    break;
                }
                b = b.parent;
            }
        }
        if (accessible && alphaZero) { accessible = false; reason = 'slot setup alpha is 0'; }
        return { accessible, alphaZero, hasSetupAttachment, resolvable, setupAttachmentName, reason };
    }

    private applySlotStatus(row: HTMLElement, badge: HTMLElement, nameEl: HTMLElement, slotName: string, manager: SpineManager): void {
        const status = this.computeSlotStatus(slotName, manager);
        let icon = '';
        let color = '';
        let tooltip = '';
        let dimmed = false;
        if (!status) {
            icon = '?'; color = 'var(--sv-text-muted)'; tooltip = 'Slot not found';
            dimmed = true;
        } else if (!status.accessible) {
            icon = '\u2715'; color = '#e05050';
            tooltip = `Not accessible in setup pose — ${status.reason}`;
            dimmed = true;
        } else if (status.hasSetupAttachment && !status.resolvable) {
            icon = '\u26A0'; color = '#e0a020';
            tooltip = `Setup attachment "${status.setupAttachmentName}" not found in current skin`;
        } else if (status.hasSetupAttachment) {
            icon = '\u25CF'; color = '#4caf50';
            tooltip = `Accessible — setup attachment: ${status.setupAttachmentName}`;
        } else {
            icon = '\u25CB'; color = '#4caf50';
            tooltip = 'Accessible — empty in setup pose (placeholder ready for content)';
        }
        badge.textContent = icon;
        badge.style.color = color;
        badge.title = tooltip;
        nameEl.style.opacity = dimmed ? '0.55' : '1';
        row.dataset.accessible = status?.accessible ? '1' : '0';
    }

    private refreshStatuses(): void {
        const rows = this.listEl.querySelectorAll<HTMLElement>('[data-slot-name]');
        rows.forEach(row => {
            const slotName = row.dataset.slotName!;
            const mgrId = row.dataset.managerId;
            const manager = mgrId ? this.managerById(mgrId) : this.spineManager;
            if (!manager) return;
            const badge = row.querySelector<HTMLElement>('.sv-placeholder-badge');
            const nameEl = badge?.nextElementSibling as HTMLElement | null;
            if (badge && nameEl) this.applySlotStatus(row, badge, nameEl, slotName, manager);
        });
        this.applyFilter();
    }

    private applyFilter(): void {
        const term = this.searchTerm;
        const rows = this.listEl.querySelectorAll<HTMLElement>('[data-slot-name]');
        rows.forEach(row => {
            const slotName = row.dataset.slotName!.toLowerCase();
            row.style.display = !term || slotName.includes(term) ? '' : 'none';
        });
    }

    private buildProjectSection(projectName: string, manager: SpineManager, entries: Entries): void {
        const section = document.createElement('div');
        section.style.marginBottom = '4px';

        const header = document.createElement('div');
        header.className = 'sv-section-header';
        header.style.cssText = 'cursor:pointer;padding:4px 0;font-weight:600;font-size:var(--sv-font-size-sm);display:flex;align-items:center;gap:4px';
        const arrow = document.createElement('span');
        arrow.className = 'sv-section-arrow';
        arrow.textContent = '▼';
        header.appendChild(arrow);
        const title = document.createElement('span');
        title.textContent = projectName;
        header.appendChild(title);

        const body = document.createElement('div');
        body.className = 'sv-section-body';

        header.addEventListener('click', () => {
            const collapsed = header.classList.toggle('collapsed');
            body.style.display = collapsed ? 'none' : '';
        });

        section.appendChild(header);
        section.appendChild(body);
        this.listEl.appendChild(section);

        const slotNames = manager.getSlotNames();
        slotNames.forEach(slotName => this.buildSlotRow(slotName, manager, entries, body));
    }

    private buildSlotRow(slotName: string, manager: SpineManager, entries: Entries, container: HTMLElement): void {
        const wrapper = document.createElement('div');
        wrapper.style.borderBottom = '1px solid var(--sv-border-light)';
        wrapper.dataset.slotName = slotName;
        wrapper.dataset.managerId = this.managerId(manager);

        const mainRow = document.createElement('div');
        mainRow.className = 'sv-control-row';
        mainRow.style.padding = '2px 0';

        const badge = document.createElement('span');
        badge.className = 'sv-placeholder-badge';
        badge.style.cssText = 'flex-shrink:0;width:14px;text-align:center;font-size:10px;line-height:14px';
        mainRow.appendChild(badge);

        const nameEl = document.createElement('span');
        nameEl.style.flex = '1';
        nameEl.style.fontSize = 'var(--sv-font-size-sm)';
        nameEl.style.overflow = 'hidden';
        nameEl.style.textOverflow = 'ellipsis';
        nameEl.style.whiteSpace = 'nowrap';
        nameEl.title = slotName;
        nameEl.textContent = slotName;
        mainRow.appendChild(nameEl);

        this.applySlotStatus(wrapper, badge, nameEl, slotName, manager);

        // Copy the slot name to the clipboard (saves manual text selection).
        const copyBtn = document.createElement('button');
        copyBtn.className = 'sv-btn sv-btn-sm';
        copyBtn.style.cssText = 'flex-shrink:0;padding:0 6px;min-width:24px;font-size:11px;line-height:18px';
        copyBtn.textContent = '⎘';
        copyBtn.title = `Copy "${slotName}"`;
        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(slotName).then(() => {
                const prev = copyBtn.textContent;
                copyBtn.textContent = '✓';
                eventBus.emit('toast', { message: `Copied "${slotName}"` });
                setTimeout(() => { copyBtn.textContent = prev; }, 1000);
            }).catch(() => {});
        });
        mainRow.appendChild(copyBtn);

        const toggleLabel = document.createElement('label');
        toggleLabel.className = 'sv-toggle';
        toggleLabel.style.flexShrink = '0';
        const input = document.createElement('input');
        input.type = 'checkbox';
        // Restore checked state if entry already has a marker
        if (entries.get(slotName)?.marker) input.checked = true;
        const trackEl = document.createElement('span');
        trackEl.className = 'sv-toggle-track';
        toggleLabel.appendChild(input);
        toggleLabel.appendChild(trackEl);
        mainRow.appendChild(toggleLabel);
        wrapper.appendChild(mainRow);

        const contentRow = document.createElement('div');
        contentRow.style.display = input.checked ? 'flex' : 'none';
        contentRow.style.flexDirection = 'column';
        contentRow.style.gap = '4px';
        contentRow.style.padding = '4px 0 6px 8px';

        // Text row
        const textRow = document.createElement('div');
        textRow.style.display = 'flex';
        textRow.style.gap = '4px';
        textRow.style.alignItems = 'center';

        const textInput = document.createElement('input');
        textInput.type = 'text';
        textInput.placeholder = 'Overlay label…';
        textInput.style.flex = '1';
        textInput.style.padding = '2px 6px';
        textInput.style.border = '1px solid var(--sv-border)';
        textInput.style.borderRadius = 'var(--sv-radius)';
        textInput.style.background = 'var(--sv-bg-input)';
        textInput.style.color = 'var(--sv-text-primary)';
        textInput.style.fontSize = 'var(--sv-font-size-sm)';
        textRow.appendChild(textInput);

        let slotTextStyle: { fontSize: number; fill: string; stroke: string; strokeThickness: number; fontFamily: string; fontWeight: string; fontStyle: string } = {
            fontSize: 14, fill: '#ffffff', stroke: '#000000', strokeThickness: 2, fontFamily: 'Arial', fontWeight: 'normal', fontStyle: 'normal',
        };

        const styleBtn = document.createElement('button');
        styleBtn.className = 'sv-btn sv-btn-sm';
        styleBtn.textContent = '\u{1F58B}';
        styleBtn.title = 'Text style options';
        styleBtn.addEventListener('click', () => {
            this.openTextStyleDialog(slotTextStyle, (newStyle) => { slotTextStyle = newStyle; });
        });
        textRow.appendChild(styleBtn);

        const setTextBtn = document.createElement('button');
        setTextBtn.className = 'sv-btn sv-btn-sm';
        setTextBtn.textContent = 'Set';
        setTextBtn.addEventListener('click', () => this.setTextContentFor(slotName, textInput.value, slotTextStyle, manager, entries));
        textRow.appendChild(setTextBtn);
        contentRow.appendChild(textRow);

        // Image row
        const imgRow = document.createElement('div');
        imgRow.style.display = 'flex';
        imgRow.style.gap = '4px';
        imgRow.style.alignItems = 'center';

        const imgBtn = document.createElement('button');
        imgBtn.className = 'sv-btn sv-btn-sm';
        imgBtn.textContent = '\uD83D\uDDBC Image';
        imgBtn.title = 'Put an image into the slot';
        imgBtn.addEventListener('click', () => {
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = 'image/*';
            fileInput.addEventListener('change', () => {
                const file = fileInput.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                    this.setImageContentFor(slotName, reader.result as string, manager, entries).then(() => {
                        imgStatus.textContent = file.name;
                        imgStatus.title = file.name;
                        syncSpineRow();
                    });
                };
                reader.readAsDataURL(file);
            });
            fileInput.click();
        });
        imgRow.appendChild(imgBtn);

        const spineBtn = document.createElement('button');
        spineBtn.className = 'sv-btn sv-btn-sm';
        spineBtn.textContent = '\u2726 Spine';
        spineBtn.title = 'Put another skeleton into the slot (skeleton + atlas + textures, or a .spine archive)';
        spineBtn.addEventListener('click', () => {
            createFileInput(true, (files) => {
                this.setSpineContentFor(slotName, files, manager, entries).then(child => {
                    imgStatus.textContent = child.name;
                    imgStatus.title = child.name;
                    syncSpineRow();
                }).catch((err: any) => {
                    console.error('Failed to load slot spine:', err);
                    eventBus.emit('toast', { message: `Slot spine: ${err?.message ?? err}`, type: 'error' });
                });
            }).click();
        });
        imgRow.appendChild(spineBtn);

        const imgStatus = document.createElement('span');
        imgStatus.style.cssText = 'flex:1;min-width:0;font-size:var(--sv-font-size-sm);color:var(--sv-text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        imgRow.appendChild(imgStatus);

        const clearBtn = document.createElement('button');
        clearBtn.className = 'sv-btn sv-btn-sm';
        clearBtn.textContent = '\u2715';
        clearBtn.title = 'Clear content';
        clearBtn.addEventListener('click', () => {
            this.clearSlotContentIn(slotName, entries);
            textInput.value = '';
            imgStatus.textContent = imgStatus.title = '';
            syncSpineRow();
        });
        imgRow.appendChild(clearBtn);
        contentRow.appendChild(imgRow);

        // Child-spine controls (shown once a skeleton sits in the slot)
        const spineRow = document.createElement('div');
        spineRow.style.cssText = 'display:none;flex-wrap:wrap;gap:4px;align-items:center';
        const animSelect = document.createElement('select');
        animSelect.className = 'sv-select';
        animSelect.style.cssText = 'flex:1;min-width:90px';
        animSelect.title = 'Animation of the slot spine';
        const skinSelect = document.createElement('select');
        skinSelect.className = 'sv-select';
        skinSelect.style.cssText = 'flex:1;min-width:70px';
        skinSelect.title = 'Skin of the slot spine';
        const makeCheck = (text: string, title: string, checked: boolean): [HTMLLabelElement, HTMLInputElement] => {
            const lbl = document.createElement('label');
            lbl.style.cssText = 'display:flex;align-items:center;gap:2px;font-size:var(--sv-font-size-sm);color:var(--sv-text-muted)';
            lbl.title = title;
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = checked;
            lbl.appendChild(cb);
            lbl.appendChild(document.createTextNode(text));
            return [lbl, cb];
        };
        const [loopLbl, loopCb] = makeCheck('Loop', 'Loop the slot spine animation', true);
        const [syncLbl, syncCb] = makeCheck('Sync', 'Pause and speed follow the parent skeleton', true);
        spineRow.append(animSelect, loopLbl, skinSelect, syncLbl);
        contentRow.appendChild(spineRow);

        const playChild = () => {
            const child = entries.get(slotName)?.child;
            if (child) this.playChildAnimation(child.spine, animSelect.value, loopCb.checked);
        };
        animSelect.addEventListener('change', playChild);
        loopCb.addEventListener('change', playChild);
        skinSelect.addEventListener('change', () => {
            const child = entries.get(slotName)?.child;
            if (!child) return;
            const skeleton: any = child.spine.skeleton;
            skeleton.setSkinByName(skinSelect.value);
            skeleton.setSlotsToSetupPose();
            (child.spine as any).update(0);
        });
        syncCb.addEventListener('change', () => {
            const entry = entries.get(slotName);
            if (!entry) return;
            entry.sync = syncCb.checked;
            if (!entry.sync && entry.child) {
                // Unsynced: the slot spine runs on its own clock again.
                entry.child.spine.autoUpdate = true;
                entry.child.spine.state.timeScale = 1;
            }
            this.ensureTicking();
        });

        const syncSpineRow = () => {
            const entry = entries.get(slotName);
            const child = entry?.child;
            spineRow.style.display = child ? 'flex' : 'none';
            if (!child) return;
            const data: any = child.spine.skeleton.data;
            animSelect.innerHTML = '';
            const setup = document.createElement('option');
            setup.value = '';
            setup.textContent = '(setup pose)';
            animSelect.appendChild(setup);
            for (const a of data.animations as any[]) {
                const opt = document.createElement('option');
                opt.value = opt.textContent = a.name;
                animSelect.appendChild(opt);
            }
            const current = (child.spine.state as any).getCurrent(0);
            animSelect.value = current?.animation?.name ?? '';
            if (current) loopCb.checked = current.loop;
            skinSelect.innerHTML = '';
            for (const s of data.skins as any[]) {
                const opt = document.createElement('option');
                opt.value = opt.textContent = s.name;
                skinSelect.appendChild(opt);
            }
            skinSelect.value = (child.spine.skeleton.skin as any)?.name ?? 'default';
            skinSelect.style.display = data.skins.length > 1 ? '' : 'none';
            syncCb.checked = entry!.sync;
        };

        // Offset / scale of whatever sits in the slot (bone-local space)
        const xfRow = document.createElement('div');
        xfRow.style.cssText = 'display:flex;gap:4px;align-items:center;font-size:var(--sv-font-size-sm);color:var(--sv-text-muted)';
        const makeNum = (label: string, value: number, step: number, apply: (e: PlaceholderEntry, v: number) => void): HTMLInputElement => {
            const lbl = document.createElement('span');
            lbl.textContent = label;
            const num = document.createElement('input');
            num.type = 'number';
            num.step = String(step);
            num.value = String(value);
            num.style.cssText = NUM_INPUT_CSS;
            num.addEventListener('input', () => {
                const v = parseFloat(num.value);
                if (!isFinite(v)) return;
                const entry = this.getOrCreateEntryIn(slotName, entries);
                apply(entry, v);
                this.applyAdjust(entry);
            });
            xfRow.append(lbl, num);
            return num;
        };
        const xInput = makeNum('X', 0, 1, (e, v) => { e.offsetX = v; });
        const yInput = makeNum('Y', 0, 1, (e, v) => { e.offsetY = v; });
        const scaleInput = makeNum('Scale', 1, 0.05, (e, v) => { e.scale = v; });
        xfRow.title = 'Offset and scale of the slot content, relative to the slot bone';
        contentRow.appendChild(xfRow);
        wrapper.appendChild(contentRow);

        // Restore the controls when the list is rebuilt around live compare-mode entries.
        const existing = entries.get(slotName);
        if (existing) {
            xInput.value = String(existing.offsetX);
            yInput.value = String(existing.offsetY);
            scaleInput.value = String(existing.scale);
            if (existing.child) imgStatus.textContent = existing.child.name;
            syncSpineRow();
        }

        input.addEventListener('change', () => {
            if (input.checked) {
                this.showMarkerFor(slotName, manager, entries);
                contentRow.style.display = 'flex';
            } else {
                this.hideSlotIn(slotName, entries);
                contentRow.style.display = 'none';
                textInput.value = '';
                imgStatus.textContent = imgStatus.title = '';
                xInput.value = '0';
                yInput.value = '0';
                scaleInput.value = '1';
                syncSpineRow();
            }
        });

        container.appendChild(wrapper);
    }

    // ── Context-aware helpers ────────────────────────────────────────────────

    private getOrCreateEntryIn(slotName: string, entries: Entries): PlaceholderEntry {
        if (!entries.has(slotName)) {
            entries.set(slotName, {
                slotName, marker: null, anchor: null, followBone: false, adjust: null,
                content: null, child: null, offsetX: 0, offsetY: 0, scale: 1, sync: true,
            });
        }
        return entries.get(slotName)!;
    }

    private getSlotContainerFrom(slotName: string, manager: SpineManager): Container | null {
        const spine = manager.spine;
        if (!spine) return null;
        if (spine instanceof SpineElement) {
            try { return spine.getSlotContainer(slotName) as Container; } catch { return null; }
        }
        return null;
    }

    private showMarkerFor(slotName: string, manager: SpineManager, entries: Entries): void {
        const entry = this.getOrCreateEntryIn(slotName, entries);
        if (entry.marker) return;

        const spine = manager.spine;
        if (!spine) return;

        const g = new Graphics();
        g.zIndex = 999;
        const size = MARKER_SIZE;
        g.lineStyle(2, 0xff6600, 0.9);
        g.moveTo(-size, 0); g.lineTo(size, 0);
        g.moveTo(0, -size); g.lineTo(0, size);
        g.lineStyle(1, 0xff6600, 0.5);
        g.drawCircle(0, 0, size);

        const labelText = new Text(slotName, {
            fontSize: 9, fill: '#ff8800', fontFamily: 'Arial',
            fontWeight: 'bold', stroke: '#000000', strokeThickness: 2,
        } as any);
        // Above the crosshair (not beside it) so it doesn't sit on centred overlay content;
        // applyFollow lifts it above the content's top edge when the slot has an overlay.
        labelText.anchor.set(0.5, 1);
        labelText.position.set(0, -size - 3);
        labelText.name = MARKER_LABEL;
        g.addChild(labelText);

        // Place at current bone position
        const slot = spine.skeleton.findSlot(slotName);
        if (slot?.bone) g.position.set(slot.bone.worldX, slot.bone.worldY);
        spine.addChild(g);

        entry.marker = g;
        // The shared loop keeps the marker glued to the bone as the animation plays.
        this.ensureTicking();
    }

    // ── Shared position-follow loop ──────────────────────────────────────────

    private ensureTicking(): void {
        if (this.tickHandle === null && this.needsTicking()) {
            this.tickHandle = requestAnimationFrame(this.tickPositions);
        }
    }

    private needsTicking(): boolean {
        const has = (entries: Entries): boolean => {
            for (const e of entries.values()) {
                if (e.marker || (e.anchor && e.followBone) || (e.child && e.sync)) return true;
            }
            return false;
        };
        if (has(this.entries)) return true;
        for (const entries of this.compareEntries.values()) if (has(entries)) return true;
        return false;
    }

    private tickPositions = (): void => {
        this.applyFollow(this.entries, this.spineManager);
        for (const [mgr, entries] of this.compareEntries) this.applyFollow(entries, mgr);
        this.tickHandle = this.needsTicking() ? requestAnimationFrame(this.tickPositions) : null;
    };

    private followMatrix = new Matrix();

    private applyFollow(entries: Entries, manager: SpineManager): void {
        const spine = manager.spine;
        if (!spine) return;
        entries.forEach(entry => {
            const slot: any = spine.skeleton.findSlot(entry.slotName);
            const bone = slot?.bone;
            if (!bone) return;
            // Bone-driven anchor (no slot container): full bone transform + slot alpha,
            // i.e. what a slot container would give it. The 4.1 runtime keeps it as a Pixi
            // matrix on the bone; spine-core has a..d (b/c are swapped in Pixi).
            if (entry.anchor && entry.followBone) {
                const m = typeof bone.matrix?.tx === 'number'
                    ? bone.matrix
                    : this.followMatrix.set(bone.a, bone.c, bone.b, bone.d, bone.worldX, bone.worldY);
                entry.anchor.transform.setFromMatrix(m);
                entry.anchor.alpha = slot.color?.a ?? 1;
                entry.anchor.visible = bone.active !== false;
            }
            if (entry.child && entry.sync && !entry.child.spine.destroyed) {
                entry.child.spine.autoUpdate = spine.autoUpdate;
                entry.child.spine.state.timeScale = spine.state.timeScale;
            }
            if (entry.marker) {
                entry.marker.position.set(bone.worldX, bone.worldY);
                this.placeMarkerLabel(entry.marker, entry.content);
            }
        });
    }

    /** Keep the marker's slot-name label clear of the overlay content drawn at the same bone. */
    private placeMarkerLabel(marker: Graphics, content: Container | null): void {
        const label = marker.getChildByName(MARKER_LABEL) as Text | null;
        if (!label) return;
        let y = -MARKER_SIZE - 3;
        if (content && !content.destroyed && content.visible && content.worldVisible) {
            const b = content.getBounds();
            if (b.width > 0 || b.height > 0) {
                // Global bounds → marker space (min of both edges handles a flipped skeleton).
                const top = marker.toLocal({ x: b.x, y: b.y } as any).y;
                const bottom = marker.toLocal({ x: b.x, y: b.y + b.height } as any).y;
                y = Math.min(y, Math.min(top, bottom) - 3);
            }
        }
        label.y = y;
    }

    // ── Slot content ─────────────────────────────────────────────────────────

    /** Put `content` into the slot (replacing what was there), under the offset/scale holder. */
    private placeContent(entry: PlaceholderEntry, manager: SpineManager, content: Sprite | Text | AnySpine, child: ChildSpine | null = null): boolean {
        this.clearContent(entry);
        const spine = manager.spine;
        if (!spine) {
            content.destroy();
            if (child?.cacheKey) clearSpineCache(child.cacheKey);
            return false;
        }
        const anchor = new Container();
        const slotContainer = this.getSlotContainerFrom(entry.slotName, manager);
        if (slotContainer) {
            slotContainer.addChild(anchor);
            entry.followBone = false;
        } else {
            anchor.zIndex = 1000;
            spine.addChild(anchor);
            entry.followBone = true;
        }
        const adjust = new Container();
        anchor.addChild(adjust);
        adjust.addChild(content);
        entry.anchor = anchor;
        entry.adjust = adjust;
        entry.content = content;
        entry.child = child;
        this.applyAdjust(entry);
        // Position a bone-driven anchor right away (not a frame late).
        this.applyFollow(new Map([[entry.slotName, entry]]), manager);
        this.ensureTicking();
        return true;
    }

    private applyAdjust(entry: PlaceholderEntry): void {
        if (!entry.adjust) return;
        entry.adjust.position.set(entry.offsetX, entry.offsetY);
        entry.adjust.scale.set(entry.scale);
    }

    private clearContent(entry: PlaceholderEntry): void {
        if (entry.content && !entry.content.destroyed) entry.content.destroy();
        if (entry.child?.cacheKey) clearSpineCache(entry.child.cacheKey);
        if (entry.anchor && !entry.anchor.destroyed) entry.anchor.destroy({ children: true });
        entry.content = null;
        entry.child = null;
        entry.anchor = null;
        entry.adjust = null;
        entry.followBone = false;
    }

    private setTextContentFor(slotName: string, text: string, style: { fontSize: number; fill: string; stroke?: string; strokeThickness?: number; fontFamily?: string; fontWeight?: string; fontStyle?: string }, manager: SpineManager, entries: Entries): void {
        const entry = this.getOrCreateEntryIn(slotName, entries);
        this.clearContent(entry);
        if (!text.trim()) return;

        const pixiText = new Text(text, {
            fontSize: style.fontSize,
            fill: style.fill,
            stroke: style.stroke ?? '#000000',
            strokeThickness: style.strokeThickness ?? Math.max(1, Math.round(style.fontSize / 6)),
            fontFamily: style.fontFamily ?? 'Arial',
            fontWeight: style.fontWeight ?? 'normal',
            fontStyle: style.fontStyle ?? 'normal',
        } as any);
        pixiText.anchor.set(0.5, 0.5);
        this.placeContent(entry, manager, pixiText);
    }

    private setImageContentFor(slotName: string, dataUrl: string, manager: SpineManager, entries: Entries): Promise<void> {
        const entry = this.getOrCreateEntryIn(slotName, entries);
        return new Promise(resolve => {
            const img = new Image();
            img.onload = () => {
                const sprite = new Sprite(Texture.from(img));
                sprite.anchor.set(0.5, 0.5);
                this.placeContent(entry, manager, sprite);
                resolve();
            };
            img.onerror = () => resolve();
            img.src = dataUrl;
        });
    }

    /**
     * Parse another skeleton (own Cache key, like a compare project) and place it into the
     * slot, in setup pose. Its origin sits on the slot bone.
     */
    private async setSpineContentFor(slotName: string, files: FileList, manager: SpineManager, entries: Entries): Promise<ChildSpine> {
        const fileSet = await loadSpineFiles(files);
        const version = detectSpineVersion(fileSet);
        const result = await parseSpineFiles(fileSet, version.detected === '4.1' ? '4.1' : '4.2');
        const child: ChildSpine = result.runtimeVersion === '4.1'
            ? { spine: new Spine41(result.skeletonData as any), cacheKey: null, name: fileSet.skeleton.name }
            : { spine: new SpineElement(result.projectName), cacheKey: result.projectName, name: fileSet.skeleton.name };
        // Symbol-style skeletons keep the art in named skins (default = shared bits only);
        // a named skin still falls back to default attachments, so picking one is safe.
        const skeleton: any = child.spine.skeleton;
        const named = (skeleton.data.skins as any[]).find(s => s.name !== 'default');
        if (named && (!skeleton.skin || skeleton.skin.name === 'default')) {
            skeleton.setSkin(named);
            skeleton.setSlotsToSetupPose();
            (child.spine as any).update(0);
        }
        const entry = this.getOrCreateEntryIn(slotName, entries);
        if (!this.placeContent(entry, manager, child.spine, child)) throw new Error('No skeleton loaded');
        return child;
    }

    /** Play `name` on the slot spine's track 0; empty name = back to setup pose. */
    private playChildAnimation(spine: AnySpine, name: string, loop: boolean): void {
        const state: any = spine.state;
        state.clearTracks();
        spine.skeleton.setToSetupPose();
        if (name) state.setAnimation(0, name, loop);
        (spine as any).update(0);
    }

    private clearSlotContentIn(slotName: string, entries: Entries): void {
        const entry = entries.get(slotName);
        if (entry) this.clearContent(entry);
    }

    private hideSlotIn(slotName: string, entries: Entries): void {
        const entry = entries.get(slotName);
        if (!entry) return;
        if (entry.marker) { entry.marker.destroy({ children: true }); entry.marker = null; }
        this.clearContent(entry);
        entries.delete(slotName);
        // The shared loop self-stops on its next frame once nothing needs following.
    }

    private clearEntriesMap(entries: Entries): void {
        entries.forEach((_, slotName) => this.hideSlotIn(slotName, entries));
        entries.clear();
    }

    private toggleAll(): void {
        const show = this.showAllToggle.checked;

        if (this.isCompareMode) {
            this.compareProjects.forEach(project => {
                const entries = this.getProjectEntries(project.manager);
                if (show) {
                    project.manager.getSlotNames().forEach(name => this.showMarkerFor(name, project.manager, entries));
                } else {
                    project.manager.getSlotNames().forEach(name => this.hideSlotIn(name, entries));
                }
            });
        } else {
            const slotNames = this.stateManager.projectA?.slotNames ?? [];
            if (show) {
                slotNames.forEach(name => this.showMarkerFor(name, this.spineManager, this.entries));
            } else {
                slotNames.forEach(name => this.hideSlotIn(name, this.entries));
            }
        }

        // Sync the slot toggles only (not the slot-spine Loop/Sync boxes). Switching off goes
        // through the row's change handler so its content controls reset too.
        this.listEl.querySelectorAll<HTMLInputElement>('.sv-toggle > input[type="checkbox"]').forEach(t => {
            if (t.checked === show) return;
            t.checked = show;
            if (!show) t.dispatchEvent(new Event('change'));
        });
    }

    private openTextStyleDialog(current: { fontSize: number; fill: string; stroke: string; strokeThickness: number; fontFamily: string; fontWeight: string; fontStyle: string }, onApply: (style: typeof current) => void): void {
        document.getElementById('sv-text-style-dialog')?.remove();

        const overlay = document.createElement('div');
        overlay.id = 'sv-text-style-dialog';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5)';

        const dialog = document.createElement('div');
        dialog.style.cssText = 'background:var(--sv-bg-surface);border:1px solid var(--sv-border);border-radius:var(--sv-radius-lg);box-shadow:var(--sv-shadow-lg);padding:16px;min-width:280px;display:flex;flex-direction:column;gap:10px';

        const title = document.createElement('div');
        title.style.cssText = 'font-weight:600;font-size:13px;margin-bottom:2px';
        title.textContent = 'Text Style';
        dialog.appendChild(title);

        const makeRow = (label: string, control: HTMLElement): void => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:8px';
            const lbl = document.createElement('span');
            lbl.style.cssText = 'font-size:11px;color:var(--sv-text-muted);min-width:100px';
            lbl.textContent = label;
            row.appendChild(lbl);
            row.appendChild(control);
            dialog.appendChild(row);
        };

        const fontSizeInput = document.createElement('input');
        fontSizeInput.type = 'number';
        fontSizeInput.value = String(current.fontSize);
        fontSizeInput.min = '6'; fontSizeInput.max = '120';
        fontSizeInput.style.cssText = 'width:60px;padding:2px 4px;border:1px solid var(--sv-border);border-radius:var(--sv-radius);background:var(--sv-bg-input);color:var(--sv-text-primary);font-size:12px';
        makeRow('Font size (px)', fontSizeInput);

        const fontFamilySelect = document.createElement('select');
        fontFamilySelect.className = 'sv-select';
        fontFamilySelect.style.flex = '1';
        ['Arial', 'Verdana', 'Courier New', 'Georgia', 'Impact', 'Trebuchet MS'].forEach(f => {
            const opt = document.createElement('option');
            opt.value = f; opt.textContent = f;
            if (f === current.fontFamily) opt.selected = true;
            fontFamilySelect.appendChild(opt);
        });
        makeRow('Font family', fontFamilySelect);

        const fontLoadBtn = document.createElement('button');
        fontLoadBtn.className = 'sv-btn sv-btn-sm';
        fontLoadBtn.textContent = 'Load font\u2026';
        fontLoadBtn.style.flex = '1';
        fontLoadBtn.addEventListener('click', () => {
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.ttf,.otf,.woff,.woff2';
            fileInput.addEventListener('change', () => {
                const file = fileInput.files?.[0];
                if (!file) return;
                const fontName = file.name.replace(/\.[^/.]+$/, '');
                const reader = new FileReader();
                reader.onload = async () => {
                    try {
                        const face = new FontFace(fontName, reader.result as ArrayBuffer);
                        await face.load();
                        (document.fonts as any).add(face);
                        const opt = document.createElement('option');
                        opt.value = fontName;
                        opt.textContent = `${fontName} (custom)`;
                        opt.selected = true;
                        fontFamilySelect.appendChild(opt);
                        fontFamilySelect.value = fontName;
                    } catch (e) {
                        console.warn('Failed to load font:', e);
                    }
                };
                reader.readAsArrayBuffer(file);
            });
            fileInput.click();
        });
        makeRow('Custom font', fontLoadBtn);

        const boldToggle = document.createElement('input');
        boldToggle.type = 'checkbox';
        boldToggle.checked = current.fontWeight === 'bold';
        makeRow('Bold', boldToggle);

        const italicToggle = document.createElement('input');
        italicToggle.type = 'checkbox';
        italicToggle.checked = current.fontStyle === 'italic';
        makeRow('Italic', italicToggle);

        const fillColor = document.createElement('input');
        fillColor.type = 'color';
        fillColor.value = current.fill;
        fillColor.className = 'sv-color-input';
        makeRow('Fill color', fillColor);

        const strokeColor = document.createElement('input');
        strokeColor.type = 'color';
        strokeColor.value = current.stroke;
        strokeColor.className = 'sv-color-input';
        makeRow('Stroke color', strokeColor);

        const strokeThicknessInput = document.createElement('input');
        strokeThicknessInput.type = 'number';
        strokeThicknessInput.value = String(current.strokeThickness);
        strokeThicknessInput.min = '0'; strokeThicknessInput.max = '20';
        strokeThicknessInput.style.cssText = 'width:60px;padding:2px 4px;border:1px solid var(--sv-border);border-radius:var(--sv-radius);background:var(--sv-bg-input);color:var(--sv-text-primary);font-size:12px';
        makeRow('Stroke thickness', strokeThicknessInput);

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:6px;margin-top:4px';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'sv-btn sv-btn-sm';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', () => overlay.remove());
        btnRow.appendChild(cancelBtn);

        const applyBtn = document.createElement('button');
        applyBtn.className = 'sv-btn sv-btn-sm sv-btn-primary';
        applyBtn.textContent = 'Apply';
        applyBtn.addEventListener('click', () => {
            onApply({
                fontSize: parseInt(fontSizeInput.value) || 14,
                fill: fillColor.value,
                stroke: strokeColor.value,
                strokeThickness: parseInt(strokeThicknessInput.value) || 0,
                fontFamily: fontFamilySelect.value,
                fontWeight: boldToggle.checked ? 'bold' : 'normal',
                fontStyle: italicToggle.checked ? 'italic' : 'normal',
            });
            overlay.remove();
        });
        btnRow.appendChild(applyBtn);
        dialog.appendChild(btnRow);

        overlay.appendChild(dialog);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
    }
}
