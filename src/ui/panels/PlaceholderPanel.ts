import { eventBus } from '../../core/EventBus';
import { Graphics, Sprite, Text, Texture } from '@electricelephants/pixi-ext';
import { SpineElement } from '@electricelephants/pixi-ext';
import type { SpineManager } from '../../core/SpineManager';
import type { StateManager } from '../../core/StateManager';
import type { Container } from '@electricelephants/pixi-ext';

interface PlaceholderEntry {
    slotName: string;
    marker: Graphics | null;
    contentSprite: Sprite | null;
    contentText: Text | null;
    rafId: number | null;
    container: Container | null;
}

export class PlaceholderPanel {
    element: HTMLElement;
    private listEl!: HTMLElement;
    private showAllToggle!: HTMLInputElement;
    private entries: Map<string, PlaceholderEntry> = new Map();

    constructor(
        private stateManager: StateManager,
        private spineManager: SpineManager,
    ) {
        this.element = document.createElement('div');
        this.build();

        eventBus.on('project:change', () => this.refresh());
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
        this.clearAll();
        this.listEl.innerHTML = '';

        const project = this.stateManager.projectA;
        if (!project) return;

        project.slotNames.forEach(slotName => {
            this.buildSlotRow(slotName);
        });
    }

    private buildSlotRow(slotName: string): void {
        const wrapper = document.createElement('div');
        wrapper.style.borderBottom = '1px solid var(--sv-border-light)';

        // Main row: name + toggle
        const mainRow = document.createElement('div');
        mainRow.className = 'sv-control-row';
        mainRow.style.padding = '2px 0';

        const name = document.createElement('span');
        name.style.flex = '1';
        name.style.fontSize = 'var(--sv-font-size-sm)';
        name.style.overflow = 'hidden';
        name.style.textOverflow = 'ellipsis';
        name.style.whiteSpace = 'nowrap';
        name.title = slotName;
        name.textContent = slotName;
        mainRow.appendChild(name);

        const toggleLabel = document.createElement('label');
        toggleLabel.className = 'sv-toggle';
        toggleLabel.style.flexShrink = '0';
        const input = document.createElement('input');
        input.type = 'checkbox';
        const trackEl = document.createElement('span');
        trackEl.className = 'sv-toggle-track';
        toggleLabel.appendChild(input);
        toggleLabel.appendChild(trackEl);
        mainRow.appendChild(toggleLabel);

        wrapper.appendChild(mainRow);

        // Content controls (hidden until toggled on)
        const contentRow = document.createElement('div');
        contentRow.style.display = 'none';
        contentRow.style.flexDirection = 'column';
        contentRow.style.gap = '4px';
        contentRow.style.padding = '4px 0 6px 8px';

        // Text row: text input + style dialog button + set button
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

        // Current text style for this slot
        let slotTextStyle: { fontSize: number; fill: string; stroke: string; strokeThickness: number; fontFamily: string; fontWeight: string; fontStyle: string } = { fontSize: 14, fill: '#ffffff', stroke: '#000000', strokeThickness: 2, fontFamily: 'Arial', fontWeight: 'normal', fontStyle: 'normal' };

        const styleBtn = document.createElement('button');
        styleBtn.className = 'sv-btn sv-btn-sm';
        styleBtn.textContent = '\u{1F58B}';
        styleBtn.title = 'Text style options';
        styleBtn.addEventListener('click', () => {
            this.openTextStyleDialog(slotTextStyle, (newStyle) => {
                slotTextStyle = newStyle;
            });
        });
        textRow.appendChild(styleBtn);

        const setTextBtn = document.createElement('button');
        setTextBtn.className = 'sv-btn sv-btn-sm';
        setTextBtn.textContent = 'Set';
        setTextBtn.addEventListener('click', () => {
            this.setTextContent(slotName, textInput.value, slotTextStyle);
        });
        textRow.appendChild(setTextBtn);
        contentRow.appendChild(textRow);

        // Image upload row
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
                    this.setImageContent(slotName, reader.result as string);
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
            this.clearSlotContent(slotName);
            textInput.value = '';
            imgStatus.textContent = '';
        });
        imgRow.appendChild(clearBtn);
        contentRow.appendChild(imgRow);

        wrapper.appendChild(contentRow);

        // Toggle logic
        input.addEventListener('change', () => {
            if (input.checked) {
                this.showMarker(slotName);
                contentRow.style.display = 'flex';
            } else {
                this.hideSlot(slotName);
                contentRow.style.display = 'none';
                textInput.value = '';
                imgStatus.textContent = '';
            }
        });

        this.listEl.appendChild(wrapper);
    }

    private getOrCreateEntry(slotName: string): PlaceholderEntry {
        if (!this.entries.has(slotName)) {
            this.entries.set(slotName, {
                slotName,
                marker: null,
                contentSprite: null,
                contentText: null,
                rafId: null,
                container: null,
            });
        }
        return this.entries.get(slotName)!;
    }

    private getSlotContainer(slotName: string): Container | null {
        const spine = this.spineManager.spine;
        if (!spine) return null;
        if (spine instanceof SpineElement) {
            try {
                return spine.getSlotContainer(slotName) as Container;
            } catch {
                return null;
            }
        }
        return null;
    }

    private showMarker(slotName: string): void {
        const entry = this.getOrCreateEntry(slotName);
        if (entry.marker) return;

        const spine = this.spineManager.spine;
        if (!spine) return;

        const g = new Graphics();
        g.zIndex = 999;
        const size = 12;
        g.lineStyle(2, 0xff6600, 0.9);
        g.moveTo(-size, 0);
        g.lineTo(size, 0);
        g.moveTo(0, -size);
        g.lineTo(0, size);
        g.lineStyle(1, 0xff6600, 0.5);
        g.drawCircle(0, 0, size);

        const label = new Text(slotName, {
            fontSize: 9,
            fill: '#ff8800',
            fontFamily: 'Arial',
            fontWeight: 'bold',
            stroke: '#000000',
            strokeThickness: 2,
        } as any);
        label.position.set(size + 3, -5);
        g.addChild(label);

        const slotContainer = this.getSlotContainer(slotName);
        if (slotContainer) {
            slotContainer.addChild(g);
            entry.container = slotContainer;
        } else {
            const slot = spine.skeleton.findSlot(slotName);
            if (slot?.bone) {
                g.position.set(slot.bone.worldX, slot.bone.worldY);
            }
            spine.addChild(g);
        }

        entry.marker = g;
    }

    private setTextContent(slotName: string, text: string, style: { fontSize: number; fill: string; stroke?: string; strokeThickness?: number; fontFamily?: string; fontWeight?: string; fontStyle?: string } = { fontSize: 14, fill: '#ffffff' }): void {
        const entry = this.getOrCreateEntry(slotName);
        this.clearSlotContent(slotName);

        if (!text.trim()) return;

        const spine = this.spineManager.spine;
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

        const slotContainer = this.getSlotContainer(slotName);
        if (slotContainer) {
            slotContainer.addChild(pixiText);
            entry.container = slotContainer;
        } else {
            spine.addChild(pixiText);
            entry.rafId = this.startPositionUpdate(slotName, pixiText);
        }
        entry.contentText = pixiText;
    }

    private openTextStyleDialog(current: { fontSize: number; fill: string; stroke: string; strokeThickness: number; fontFamily: string; fontWeight: string; fontStyle: string }, onApply: (style: typeof current) => void): void {
        // Remove existing dialog if open
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

    private setImageContent(slotName: string, dataUrl: string): void {
        const entry = this.getOrCreateEntry(slotName);
        // Remove old sprite/text but keep marker
        if (entry.contentSprite) { entry.contentSprite.destroy(); entry.contentSprite = null; }
        if (entry.contentText) { entry.contentText.destroy(); entry.contentText = null; }
        if (entry.rafId !== null) { cancelAnimationFrame(entry.rafId); entry.rafId = null; }

        const spine = this.spineManager.spine;
        if (!spine) return;

        const img = new Image();
        img.onload = () => {
            const texture = Texture.from(img);
            const sprite = new Sprite(texture);
            sprite.anchor.set(0.5, 0.5);
            sprite.zIndex = 1000;

            const slotContainer = this.getSlotContainer(slotName);
            if (slotContainer) {
                slotContainer.addChild(sprite);
                entry.container = slotContainer;
            } else {
                spine.addChild(sprite);
                entry.rafId = this.startPositionUpdate(slotName, sprite);
            }
            entry.contentSprite = sprite;
        };
        img.src = dataUrl;
    }

    private startPositionUpdate(slotName: string, obj: { position: { set(x: number, y: number): void } }): number {
        const update = () => {
            const spine = this.spineManager.spine;
            if (!spine) return;
            const slot = spine.skeleton.findSlot(slotName);
            if (slot?.bone) {
                obj.position.set(slot.bone.worldX, slot.bone.worldY);
            }
            const entry = this.entries.get(slotName);
            if (entry) {
                entry.rafId = requestAnimationFrame(update);
            }
        };
        return requestAnimationFrame(update);
    }

    private clearSlotContent(slotName: string): void {
        const entry = this.entries.get(slotName);
        if (!entry) return;
        if (entry.contentSprite) { entry.contentSprite.destroy(); entry.contentSprite = null; }
        if (entry.contentText) { entry.contentText.destroy(); entry.contentText = null; }
        if (entry.rafId !== null) { cancelAnimationFrame(entry.rafId); entry.rafId = null; }
    }

    private hideSlot(slotName: string): void {
        const entry = this.entries.get(slotName);
        if (!entry) return;
        if (entry.marker) { entry.marker.destroy(); entry.marker = null; }
        this.clearSlotContent(slotName);
        this.entries.delete(slotName);
    }

    private toggleAll(): void {
        const show = this.showAllToggle.checked;
        const project = this.stateManager.projectA;
        if (!project) return;

        if (show) {
            project.slotNames.forEach(name => this.showMarker(name));
        } else {
            project.slotNames.forEach(name => this.hideSlot(name));
        }

        const toggles = this.listEl.querySelectorAll('input[type="checkbox"]');
        toggles.forEach(t => (t as HTMLInputElement).checked = show);
    }

    private clearAll(): void {
        this.entries.forEach((_, slotName) => this.hideSlot(slotName));
        this.entries.clear();
    }
}
