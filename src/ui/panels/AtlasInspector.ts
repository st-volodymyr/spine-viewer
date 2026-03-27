import { eventBus } from '../../core/EventBus';
import { parseAtlasText, type AtlasRegion, type ParsedAtlas } from '../../services/AtlasParser';
import type { SpineFileSet } from '../../types/spine';

export class AtlasInspectorPanel {
    element: HTMLElement;
    private searchInput!: HTMLInputElement;
    private regionList!: HTMLElement;
    private previewCanvas!: HTMLCanvasElement;
    private previewCtx!: CanvasRenderingContext2D;
    private detailPanel!: HTMLElement;
    private statsPanel!: HTMLElement;
    private atlasData: ParsedAtlas | null = null;
    private textureImages: Map<string, HTMLImageElement> = new Map();
    private selectedRegion: AtlasRegion | null = null;
    private usedRegionNames: Set<string> = new Set();

    constructor() {
        this.element = document.createElement('div');
        this.element.style.display = 'flex';
        this.element.style.flexDirection = 'column';
        this.build();

        eventBus.on('atlas:loaded', (data: { atlas: ParsedAtlas; textures: SpineFileSet['textures']; usedRegionNames?: Set<string> }) => {
            this.usedRegionNames = data.usedRegionNames ?? new Set();
            this.setAtlasData(data.atlas, data.textures);
        });
    }

    private build(): void {
        // Stats overview (shown when atlas is loaded)
        this.statsPanel = document.createElement('div');
        this.statsPanel.style.padding = '4px 0';
        this.element.appendChild(this.statsPanel);

        // Preview canvas
        const previewWrap = document.createElement('div');
        previewWrap.style.position = 'relative';
        previewWrap.style.height = '120px';
        previewWrap.style.background = 'var(--sv-bg-viewport)';
        previewWrap.style.border = '1px solid var(--sv-border)';
        previewWrap.style.borderRadius = 'var(--sv-radius)';
        previewWrap.style.overflow = 'hidden';
        previewWrap.style.flexShrink = '0';
        previewWrap.style.display = 'none'; // Hidden until a region is selected
        previewWrap.id = 'sv-atlas-preview-wrap';
        this.previewCanvas = document.createElement('canvas');
        this.previewCanvas.style.width = '100%';
        this.previewCanvas.style.height = '100%';
        previewWrap.appendChild(this.previewCanvas);
        this.previewCtx = this.previewCanvas.getContext('2d')!;
        this.element.appendChild(previewWrap);

        // Detail panel (shown when a region is selected)
        this.detailPanel = document.createElement('div');
        this.detailPanel.className = 'sv-detail-panel';
        this.detailPanel.style.flexShrink = '0';
        this.element.appendChild(this.detailPanel);

        // Search
        this.searchInput = document.createElement('input');
        this.searchInput.className = 'sv-tree-search';
        this.searchInput.placeholder = 'Filter regions...';
        this.searchInput.style.margin = '4px 0';
        this.searchInput.addEventListener('input', () => this.renderRegionList());
        this.element.appendChild(this.searchInput);

        // View full atlas button
        const viewBtn = document.createElement('button');
        viewBtn.className = 'sv-btn sv-btn-sm';
        viewBtn.textContent = 'View Full Atlas';
        viewBtn.style.width = '100%';
        viewBtn.style.justifyContent = 'center';
        viewBtn.style.marginBottom = '4px';
        viewBtn.addEventListener('click', () => this.openAtlasViewer());
        this.element.appendChild(viewBtn);

        // Region list
        this.regionList = document.createElement('div');
        this.regionList.style.flex = '1';
        this.regionList.style.overflowY = 'auto';
        this.regionList.style.minHeight = '0';
        this.element.appendChild(this.regionList);
    }

    setAtlasData(atlas: ParsedAtlas, textures: SpineFileSet['textures']): void {
        this.atlasData = atlas;
        this.textureImages.clear();
        this.selectedRegion = null;

        // Load texture images
        textures.forEach(tex => {
            const img = new Image();
            img.src = tex.data;
            this.textureImages.set(tex.name, img);
        });

        this.renderStats();
        this.renderRegionList();
    }

    private renderStats(): void {
        this.statsPanel.innerHTML = '';
        if (!this.atlasData) return;

        const { pages, regions } = this.atlasData;

        // Calculate total texture area
        let totalPixels = 0;
        let usedPixels = 0;
        pages.forEach(p => { totalPixels += p.width * p.height; });
        regions.forEach(r => { usedPixels += r.width * r.height; });
        const packing = totalPixels > 0 ? Math.round((usedPixels / totalPixels) * 100) : 0;

        // Count rotated regions
        const rotated = regions.filter(r => r.rotate).length;

        // Find size extremes
        const areas = regions.map(r => r.width * r.height);
        const largest = areas.length > 0 ? Math.max(...areas) : 0;
        const smallest = areas.length > 0 ? Math.min(...areas) : 0;

        // Stats grid
        const grid = document.createElement('div');
        grid.className = 'sv-atlas-stats';

        const stats: [string, string][] = [
            ['Pages', String(pages.length)],
            ['Regions', String(regions.length)],
            ['Packing', `${packing}%`],
            ['Rotated', String(rotated)],
        ];

        // Usage stats
        const unusedCount = this.usedRegionNames.size > 0
            ? regions.filter(r => !this.usedRegionNames.has(r.name)).length
            : 0;
        if (this.usedRegionNames.size > 0) {
            stats.push(['Unused', String(unusedCount)]);
        }

        stats.forEach(([label, value]) => {
            const cell = document.createElement('div');
            cell.className = 'sv-atlas-stat';
            const valEl = document.createElement('div');
            valEl.className = 'sv-atlas-stat-value';
            valEl.textContent = value;
            cell.appendChild(valEl);
            const lblEl = document.createElement('div');
            lblEl.className = 'sv-atlas-stat-label';
            lblEl.textContent = label;
            cell.appendChild(lblEl);
            grid.appendChild(cell);
        });

        this.statsPanel.appendChild(grid);

        // Page info
        pages.forEach(page => {
            const pageRegions = regions.filter(r => r.page === page.name);
            const pageUsed = pageRegions.reduce((sum, r) => sum + r.width * r.height, 0);
            const pagePct = page.width * page.height > 0 ? Math.round((pageUsed / (page.width * page.height)) * 100) : 0;

            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 0;font-size:var(--sv-font-size-sm);color:var(--sv-text-secondary)';
            row.innerHTML = `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${page.name}">${page.name}</span>` +
                `<span style="font-family:var(--sv-font-mono);color:var(--sv-text-muted)">${page.width}\u00D7${page.height}</span>` +
                `<span style="font-family:var(--sv-font-mono)">${pageRegions.length} rgn</span>` +
                `<span style="font-family:var(--sv-font-mono);color:${pagePct > 80 ? 'var(--sv-success)' : pagePct > 50 ? 'var(--sv-warning)' : 'var(--sv-error)'}">${pagePct}%</span>`;
            this.statsPanel.appendChild(row);
        });
    }

    private renderRegionList(): void {
        this.regionList.innerHTML = '';
        if (!this.atlasData) return;

        const filter = this.searchInput.value.toLowerCase();
        const regions = filter
            ? this.atlasData.regions.filter(r => r.name.toLowerCase().includes(filter))
            : this.atlasData.regions;

        // Group by page
        const byPage = new Map<string, AtlasRegion[]>();
        regions.forEach(r => {
            if (!byPage.has(r.page)) byPage.set(r.page, []);
            byPage.get(r.page)!.push(r);
        });

        byPage.forEach((pageRegions, pageName) => {
            // Page header
            const pageHeader = document.createElement('div');
            pageHeader.className = 'sv-atlas-page-header';
            const arrow = document.createElement('span');
            arrow.className = 'sv-section-arrow';
            arrow.textContent = '\u25BC';
            pageHeader.appendChild(arrow);
            const nameEl = document.createElement('span');
            nameEl.style.flex = '1';
            nameEl.textContent = pageName;
            pageHeader.appendChild(nameEl);
            const badge = document.createElement('span');
            badge.style.cssText = 'font-size:10px;color:var(--sv-text-muted);font-family:var(--sv-font-mono)';
            badge.textContent = String(pageRegions.length);
            pageHeader.appendChild(badge);

            let collapsed = false;
            pageHeader.addEventListener('click', () => {
                collapsed = !collapsed;
                arrow.style.transform = collapsed ? 'rotate(-90deg)' : '';
                pageBody.style.display = collapsed ? 'none' : 'block';
            });
            this.regionList.appendChild(pageHeader);

            const pageBody = document.createElement('div');

            pageRegions.forEach(region => {
                const row = document.createElement('div');
                row.className = 'sv-atlas-region-row';
                if (this.selectedRegion === region) row.classList.add('selected');

                if (this.usedRegionNames.size > 0) {
                    const dot = document.createElement('span');
                    const isUsed = this.usedRegionNames.has(region.name);
                    dot.style.cssText = `width:6px;height:6px;border-radius:50%;flex-shrink:0;background:${isUsed ? 'var(--sv-success)' : 'var(--sv-text-muted)'}`;
                    dot.title = isUsed ? 'Referenced in skin' : 'Not referenced in any skin';
                    row.appendChild(dot);
                }

                const name = document.createElement('span');
                name.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
                name.textContent = region.name;
                row.appendChild(name);

                const size = document.createElement('span');
                size.style.cssText = 'font-size:10px;color:var(--sv-text-muted);font-family:var(--sv-font-mono);flex-shrink:0';
                size.textContent = `${region.width}\u00D7${region.height}`;
                if (region.rotate) size.textContent += ' R';
                row.appendChild(size);

                row.addEventListener('click', () => {
                    this.selectRegion(region);
                    this.regionList.querySelectorAll('.sv-atlas-region-row.selected').forEach(el => el.classList.remove('selected'));
                    row.classList.add('selected');
                });

                pageBody.appendChild(row);
            });

            this.regionList.appendChild(pageBody);
        });
    }

    private selectRegion(region: AtlasRegion): void {
        this.selectedRegion = region;

        // Show preview
        const previewWrap = document.getElementById('sv-atlas-preview-wrap');
        if (previewWrap) previewWrap.style.display = 'block';

        // Update detail panel
        this.detailPanel.innerHTML = '';
        const details: [string, string][] = [
            ['Name', region.name],
            ['Page', region.page],
            ['Position', `${region.x}, ${region.y}`],
            ['Size', `${region.width} \u00D7 ${region.height}`],
            ['Original', `${region.originalWidth} \u00D7 ${region.originalHeight}`],
            ['Offset', `${region.offsetX}, ${region.offsetY}`],
            ['Rotate', String(region.rotate)],
        ];
        details.forEach(([key, value]) => {
            const row = document.createElement('div');
            row.className = 'sv-detail-row';
            const keyEl = document.createElement('span');
            keyEl.className = 'sv-detail-key';
            keyEl.textContent = key;
            row.appendChild(keyEl);
            const valEl = document.createElement('span');
            valEl.className = 'sv-detail-value';
            valEl.textContent = value;
            row.appendChild(valEl);
            this.detailPanel.appendChild(row);
        });

        this.drawPreview(region);
    }

    private openAtlasViewer(): void {
        if (!this.atlasData || this.textureImages.size === 0) return;

        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center';

        const box = document.createElement('div');
        box.style.cssText = 'background:var(--sv-bg-surface);border:1px solid var(--sv-border);border-radius:var(--sv-radius-lg);padding:12px;display:flex;flex-direction:column;gap:6px;max-width:90vw;max-height:90vh';

        // Title + close
        const titleRow = document.createElement('div');
        titleRow.style.cssText = 'display:flex;align-items:center;gap:8px';
        const title = document.createElement('span');
        title.style.cssText = 'font-weight:600;flex:1;font-size:13px';
        title.textContent = 'Atlas Viewer';
        titleRow.appendChild(title);

        // Page selector if multiple pages
        if (this.atlasData.pages.length > 1) {
            const pageSelect = document.createElement('select');
            pageSelect.className = 'sv-select';
            this.atlasData.pages.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.name;
                opt.textContent = p.name;
                pageSelect.appendChild(opt);
            });
            pageSelect.addEventListener('change', () => drawPage(pageSelect.value));
            titleRow.appendChild(pageSelect);
        }

        const closeBtn = document.createElement('button');
        closeBtn.className = 'sv-btn sv-btn-sm';
        closeBtn.textContent = '\u00D7';
        closeBtn.addEventListener('click', () => overlay.remove());
        titleRow.appendChild(closeBtn);
        box.appendChild(titleRow);

        // Info row
        const infoEl = document.createElement('div');
        infoEl.style.cssText = 'font-size:var(--sv-font-size-sm);color:var(--sv-text-muted)';
        box.appendChild(infoEl);

        // Canvas
        const canvasWrap = document.createElement('div');
        canvasWrap.style.cssText = 'overflow:auto;flex:1;cursor:crosshair';
        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'display:block;image-rendering:pixelated';
        canvasWrap.appendChild(canvas);
        box.appendChild(canvasWrap);

        const drawPage = (pageName: string) => {
            const page = this.atlasData!.pages.find(p => p.name === pageName);
            if (!page) return;
            const img = this.textureImages.get(page.name);
            if (!img || !img.complete) return;

            canvas.width = img.naturalWidth || page.width;
            canvas.height = img.naturalHeight || page.height;
            const ctx = canvas.getContext('2d')!;

            // Checkerboard
            const cs = 16;
            for (let y = 0; y < canvas.height; y += cs) {
                for (let x = 0; x < canvas.width; x += cs) {
                    ctx.fillStyle = ((x / cs + y / cs) % 2 === 0) ? '#333' : '#3a3a3a';
                    ctx.fillRect(x, y, cs, cs);
                }
            }

            ctx.drawImage(img, 0, 0);

            // Draw region outlines
            const regions = this.atlasData!.regions.filter(r => r.page === pageName);
            ctx.strokeStyle = 'rgba(138,180,248,0.6)';
            ctx.lineWidth = 1;
            regions.forEach(r => {
                ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.width, r.height);
            });

            infoEl.textContent = `${page.name} \u2014 ${canvas.width}\u00D7${canvas.height}px \u2014 ${regions.length} regions`;

            // Hover tooltip
            canvas.onmousemove = (e) => {
                const rect = canvas.getBoundingClientRect();
                const scaleX = canvas.width / rect.width;
                const scaleY = canvas.height / rect.height;
                const mx = (e.clientX - rect.left) * scaleX;
                const my = (e.clientY - rect.top) * scaleY;
                const hit = regions.find(r => mx >= r.x && mx <= r.x + r.width && my >= r.y && my <= r.y + r.height);
                canvas.title = hit ? `${hit.name} (${hit.width}\u00D7${hit.height})` : '';
            };
        };

        // Scale canvas to fit
        canvas.style.maxWidth = 'min(80vw, 900px)';
        canvas.style.maxHeight = 'calc(90vh - 100px)';
        canvas.style.width = 'auto';
        canvas.style.height = 'auto';

        overlay.appendChild(box);
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        // Draw first page after images may load
        const firstPage = this.atlasData.pages[0];
        const firstImg = this.textureImages.get(firstPage.name);
        if (firstImg?.complete) {
            drawPage(firstPage.name);
        } else if (firstImg) {
            firstImg.onload = () => drawPage(firstPage.name);
        }
    }

    private drawPreview(region: AtlasRegion): void {
        const img = this.textureImages.get(region.page);
        if (!img) return;

        const canvas = this.previewCanvas;
        const ctx = this.previewCtx;
        canvas.width = canvas.parentElement!.clientWidth || 240;
        canvas.height = canvas.parentElement!.clientHeight || 120;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw checkerboard (dark)
        const checkSize = 8;
        for (let y = 0; y < canvas.height; y += checkSize) {
            for (let x = 0; x < canvas.width; x += checkSize) {
                ctx.fillStyle = ((x / checkSize + y / checkSize) % 2 === 0) ? '#2a2a2a' : '#333';
                ctx.fillRect(x, y, checkSize, checkSize);
            }
        }

        // Draw region centered
        const scale = Math.min(
            (canvas.width - 16) / region.width,
            (canvas.height - 16) / region.height,
            2
        );
        const drawW = region.width * scale;
        const drawH = region.height * scale;
        const drawX = (canvas.width - drawW) / 2;
        const drawY = (canvas.height - drawH) / 2;

        if (img.complete) {
            ctx.drawImage(
                img,
                region.x, region.y, region.width, region.height,
                drawX, drawY, drawW, drawH
            );
        } else {
            img.onload = () => this.drawPreview(region);
        }
    }
}
