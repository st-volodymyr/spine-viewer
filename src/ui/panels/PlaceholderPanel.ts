import { eventBus } from '../../core/EventBus';
import { Graphics, Sprite, Text, Texture } from '@electricelephants/pixi-ext';
import { SpineElement } from '@electricelephants/pixi-ext';
import type { SpineManager } from '../../core/SpineManager';
import type { StateManager } from '../../core/StateManager';
import type { Container } from '@electricelephants/pixi-ext';

interface PlaceholderEntry {
    slotName: string;
    marker: Graphics | null;
    markerRafId: number | null;
    contentSprite: Sprite | null;
    contentText: Text | null;
    rafId: number | null;
    container: Container | null;
}

type Entries = Map<string, PlaceholderEntry>;

interface CompareProjectRef {
    name: string;
    manager: SpineManager;
}

export class PlaceholderPanel {
    element: HTMLElement;
    private listEl!: HTMLElement;
    private showAllToggle!: HTMLInputElement;

    // Single-mode entries
    private entries: Entries = new Map();

    // Compare-mode: per-project entries, preserved across refreshes
    private compareEntries: Map<SpineManager, Entries> = new Map();
    private compareProjects: CompareProjectRef[] = [];
    private isCompareMode = false;

    constructor(
        private stateManager: StateManager,
        private spineManager: SpineManager,
    ) {
        this.element = document.createElement('div');
        this.build();

        eventBus.on('project:change', () => this.refresh());
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
        info.textContent = 'Toggle a slot to show its marker. Set a label or image to overlay content at that position.';
        this.element.appendChild(info);

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

        const mainRow = document.createElement('div');
        mainRow.className = 'sv-control-row';
        mainRow.style.padding = '2px 0';

        const nameEl = document.createElement('span');
        nameEl.style.flex = '1';
        nameEl.style.fontSize = 'var(--sv-font-size-sm)';
        nameEl.style.overflow = 'hidden';
        nameEl.style.textOverflow = 'ellipsis';
        nameEl.style.whiteSpace = 'nowrap';
        nameEl.title = slotName;
        nameEl.textContent = slotName;
        mainRow.appendChild(nameEl);

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
        imgBtn.textContent = '\uD83D\uDDBC Upload Image';
        imgBtn.addEventListener('click', () => {
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = 'image/*';
            fileInput.addEventListener('change', () => {
                const file = fileInput.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                    this.setImageContentFor(slotName, reader.result as string, manager, entries);
                    imgStatus.textContent = file.name;
                };
                reader.readAsDataURL(file);
            });
            fileInput.click();
        });
        imgRow.appendChild(imgBtn);

        const imgStatus = document.createElement('span');
        imgStatus.style.fontSize = 'var(--sv-font-size-sm)';
        imgStatus.style.color = 'var(--sv-text-muted)';
        imgStatus.style.overflow = 'hidden';
        imgStatus.style.textOverflow = 'ellipsis';
        imgStatus.style.whiteSpace = 'nowrap';
        imgRow.appendChild(imgStatus);

        const clearBtn = document.createElement('button');
        clearBtn.className = 'sv-btn sv-btn-sm';
        clearBtn.textContent = '\u2715';
        clearBtn.title = 'Clear content';
        clearBtn.addEventListener('click', () => {
            this.clearSlotContentIn(slotName, entries);
            textInput.value = '';
            imgStatus.textContent = '';
        });
        imgRow.appendChild(clearBtn);
        contentRow.appendChild(imgRow);
        wrapper.appendChild(contentRow);

        input.addEventListener('change', () => {
            if (input.checked) {
                this.showMarkerFor(slotName, manager, entries);
                contentRow.style.display = 'flex';
            } else {
                this.hideSlotIn(slotName, entries);
                contentRow.style.display = 'none';
                textInput.value = '';
                imgStatus.textContent = '';
            }
        });

        container.appendChild(wrapper);
    }

    // ── Context-aware helpers ────────────────────────────────────────────────

    private getOrCreateEntryIn(slotName: string, entries: Entries): PlaceholderEntry {
        if (!entries.has(slotName)) {
            entries.set(slotName, { slotName, marker: null, markerRafId: null, contentSprite: null, contentText: null, rafId: null, container: null });
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
        const size = 12;
        g.lineStyle(2, 0xff6600, 0.9);
        g.moveTo(-size, 0); g.lineTo(size, 0);
        g.moveTo(0, -size); g.lineTo(0, size);
        g.lineStyle(1, 0xff6600, 0.5);
        g.drawCircle(0, 0, size);

        const labelText = new Text(slotName, {
            fontSize: 9, fill: '#ff8800', fontFamily: 'Arial',
            fontWeight: 'bold', stroke: '#000000', strokeThickness: 2,
        } as any);
        labelText.position.set(size + 3, -5);
        g.addChild(labelText);

        // Place at current bone position
        const slot = spine.skeleton.findSlot(slotName);
        if (slot?.bone) g.position.set(slot.bone.worldX, slot.bone.worldY);
        spine.addChild(g);

        entry.marker = g;
        // Keep updating position so marker follows the animation
        entry.markerRafId = this.startMarkerPositionUpdate(slotName, g, manager, entries);
    }

    private startMarkerPositionUpdate(slotName: string, g: Graphics, manager: SpineManager, entries: Entries): number {
        const update = () => {
            const spine = manager.spine;
            if (!spine) return;
            const slot = spine.skeleton.findSlot(slotName);
            if (slot?.bone) g.position.set(slot.bone.worldX, slot.bone.worldY);
            const entry = entries.get(slotName);
            if (entry?.marker) entry.markerRafId = requestAnimationFrame(update);
        };
        return requestAnimationFrame(update);
    }

    private setTextContentFor(slotName: string, text: string, style: { fontSize: number; fill: string; stroke?: string; strokeThickness?: number; fontFamily?: string; fontWeight?: string; fontStyle?: string }, manager: SpineManager, entries: Entries): void {
        const entry = this.getOrCreateEntryIn(slotName, entries);
        this.clearSlotContentIn(slotName, entries);
        if (!text.trim()) return;

        const spine = manager.spine;
        if (!spine) return;

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
        pixiText.zIndex = 1000;

        const slotContainer = this.getSlotContainerFrom(slotName, manager);
        if (slotContainer) {
            slotContainer.addChild(pixiText);
            entry.container = slotContainer;
        } else {
            spine.addChild(pixiText);
            entry.rafId = this.startPositionUpdateFor(slotName, pixiText, manager, entries);
        }
        entry.contentText = pixiText;
    }

    private setImageContentFor(slotName: string, dataUrl: string, manager: SpineManager, entries: Entries): void {
        const entry = this.getOrCreateEntryIn(slotName, entries);
        if (entry.contentSprite) { entry.contentSprite.destroy(); entry.contentSprite = null; }
        if (entry.contentText) { entry.contentText.destroy(); entry.contentText = null; }
        if (entry.rafId !== null) { cancelAnimationFrame(entry.rafId); entry.rafId = null; }

        const spine = manager.spine;
        if (!spine) return;

        const img = new Image();
        img.onload = () => {
            const texture = Texture.from(img);
            const sprite = new Sprite(texture);
            sprite.anchor.set(0.5, 0.5);
            sprite.zIndex = 1000;

            const slotContainer = this.getSlotContainerFrom(slotName, manager);
            if (slotContainer) {
                slotContainer.addChild(sprite);
                entry.container = slotContainer;
            } else {
                spine.addChild(sprite);
                entry.rafId = this.startPositionUpdateFor(slotName, sprite, manager, entries);
            }
            entry.contentSprite = sprite;
        };
        img.src = dataUrl;
    }

    private startPositionUpdateFor(slotName: string, obj: { position: { set(x: number, y: number): void } }, manager: SpineManager, entries: Entries): number {
        const update = () => {
            const spine = manager.spine;
            if (!spine) return;
            const slot = spine.skeleton.findSlot(slotName);
            if (slot?.bone) obj.position.set(slot.bone.worldX, slot.bone.worldY);
            const entry = entries.get(slotName);
            if (entry) entry.rafId = requestAnimationFrame(update);
        };
        return requestAnimationFrame(update);
    }

    private clearSlotContentIn(slotName: string, entries: Entries): void {
        const entry = entries.get(slotName);
        if (!entry) return;
        if (entry.contentSprite) { entry.contentSprite.destroy(); entry.contentSprite = null; }
        if (entry.contentText) { entry.contentText.destroy(); entry.contentText = null; }
        if (entry.rafId !== null) { cancelAnimationFrame(entry.rafId); entry.rafId = null; }
    }

    private hideSlotIn(slotName: string, entries: Entries): void {
        const entry = entries.get(slotName);
        if (!entry) return;
        if (entry.markerRafId !== null) { cancelAnimationFrame(entry.markerRafId); entry.markerRafId = null; }
        if (entry.marker) { entry.marker.destroy(); entry.marker = null; }
        this.clearSlotContentIn(slotName, entries);
        entries.delete(slotName);
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

        // Sync toggle state in DOM
        this.listEl.querySelectorAll('input[type="checkbox"]').forEach(t => {
            (t as HTMLInputElement).checked = show;
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
