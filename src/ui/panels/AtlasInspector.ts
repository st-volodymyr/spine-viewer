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
    private atlasData: ParsedAtlas | null = null;
    private textureImages: Map<string, HTMLImageElement> = new Map();
    private selectedRegion: AtlasRegion | null = null;

    constructor() {
        this.element = document.createElement('div');
        this.element.style.display = 'flex';
        this.element.style.flexDirection = 'column';
        this.build();

        eventBus.on('atlas:loaded', (data: { atlas: ParsedAtlas; textures: SpineFileSet['textures'] }) => {
            this.setAtlasData(data.atlas, data.textures);
        });
    }

    private build(): void {
        // Search
        this.searchInput = document.createElement('input');
        this.searchInput.className = 'sv-tree-search';
        this.searchInput.placeholder = 'Search regions...';
        this.searchInput.addEventListener('input', () => this.renderRegionList());
        this.element.appendChild(this.searchInput);

        // View full atlas button row
        const viewRow = document.createElement('div');
        viewRow.style.cssText = 'display:flex;gap:4px;padding:4px 0;align-items:center';
        const viewBtn = document.createElement('button');
        viewBtn.className = 'sv-btn sv-btn-sm sv-btn-primary';
        viewBtn.textContent = '\uD83D\uDDBC View Full Atlas';
        viewBtn.style.flex = '1';
        viewBtn.addEventListener('click', () => this.openAtlasViewer());
        viewRow.appendChild(viewBtn);
        this.element.appendChild(viewRow);

        // Preview canvas
        const previewWrap = document.createElement('div');
        previewWrap.style.position = 'relative';
        previewWrap.style.height = '150px';
        previewWrap.style.background = 'var(--sv-bg-viewport)';
        previewWrap.style.border = '1px solid var(--sv-border)';
        previewWrap.style.borderRadius = 'var(--sv-radius)';
        previewWrap.style.overflow = 'hidden';
        previewWrap.style.flexShrink = '0';
        this.previewCanvas = document.createElement('canvas');
        this.previewCanvas.style.width = '100%';
        this.previewCanvas.style.height = '100%';
        previewWrap.appendChild(this.previewCanvas);
        this.previewCtx = this.previewCanvas.getContext('2d')!;
        this.element.appendChild(previewWrap);

        // Detail panel
        this.detailPanel = document.createElement('div');
        this.detailPanel.className = 'sv-detail-panel';
        this.detailPanel.style.flexShrink = '0';
        this.detailPanel.style.maxHeight = '100px';
        this.detailPanel.style.overflow = 'auto';
        this.element.appendChild(this.detailPanel);

        // Region list
        this.regionList = document.createElement('div');
        this.regionList.style.maxHeight = '320px';
        this.regionList.style.overflowY = 'auto';
        this.element.appendChild(this.regionList);
    }

    setAtlasData(atlas: ParsedAtlas, textures: SpineFileSet['textures']): void {
        this.atlasData = atlas;
        this.textureImages.clear();

        // Load texture images
        textures.forEach(tex => {
            const img = new Image();
            img.src = tex.data;
            this.textureImages.set(tex.name, img);
        });

        this.renderRegionList();
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
            pageHeader.className = 'sv-section-header';
            pageHeader.innerHTML = `<span class="sv-section-arrow">\u25BC</span><span>${pageName}</span><span class="sv-tree-badge">${pageRegions.length}</span>`;
            pageHeader.addEventListener('click', () => {
                pageHeader.classList.toggle('collapsed');
            });
            this.regionList.appendChild(pageHeader);

            const pageBody = document.createElement('div');
            pageBody.className = 'sv-section-body';
            pageBody.style.padding = '0';

            pageRegions.forEach(region => {
                const row = document.createElement('div');
                row.className = 'sv-tree-node-row';
                row.style.padding = '2px 8px';
                row.style.fontSize = 'var(--sv-font-size-sm)';

                const name = document.createElement('span');
                name.style.flex = '1';
                name.textContent = region.name;
                row.appendChild(name);

                const size = document.createElement('span');
                size.className = 'sv-tree-badge';
                size.textContent = `${region.width}x${region.height}`;
                row.appendChild(size);

                row.addEventListener('click', () => {
                    this.selectRegion(region);
                    // Highlight selected
                    this.regionList.querySelectorAll('.sv-tree-node-row.selected').forEach(el => el.classList.remove('selected'));
                    row.classList.add('selected');
                });

                pageBody.appendChild(row);
            });

            this.regionList.appendChild(pageBody);
        });
    }

    private selectRegion(region: AtlasRegion): void {
        this.selectedRegion = region;

        // Update detail panel
        this.detailPanel.innerHTML = '';
        const details: [string, string][] = [
            ['Name', region.name],
            ['Page', region.page],
            ['Position', `${region.x}, ${region.y}`],
            ['Size', `${region.width} x ${region.height}`],
            ['Original', `${region.originalWidth} x ${region.originalHeight}`],
            ['Offset', `${region.offsetX}, ${region.offsetY}`],
            ['Rotate', String(region.rotate)],
        ];
        details.forEach(([key, value]) => {
            const row = document.createElement('div');
            row.className = 'sv-detail-row';
            row.innerHTML = `<span class="sv-detail-key">${key}</span><span class="sv-detail-value">${value}</span>`;
            this.detailPanel.appendChild(row);
        });

        // Draw preview
        this.drawPreview(region);
    }

    private openAtlasViewer(): void {
        if (!this.atlasData || this.textureImages.size === 0) return;

        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center';

        const box = document.createElement('div');
        box.style.cssText = 'background:var(--sv-bg-surface);border-radius:var(--sv-radius-lg);padding:16px;display:flex;flex-direction:column;gap:8px;max-width:90vw;max-height:90vh';

        // Title + close
        const titleRow = document.createElement('div');
        titleRow.style.cssText = 'display:flex;align-items:center;gap:8px';
        const title = document.createElement('span');
        title.style.fontWeight = '600';
        title.style.flex = '1';
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
        closeBtn.textContent = '\u00D7 Close';
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
                    ctx.fillStyle = ((x / cs + y / cs) % 2 === 0) ? '#999' : '#bbb';
                    ctx.fillRect(x, y, cs, cs);
                }
            }

            ctx.drawImage(img, 0, 0);

            // Draw region outlines
            const regions = this.atlasData!.regions.filter(r => r.page === pageName);
            ctx.strokeStyle = 'rgba(74,127,181,0.8)';
            ctx.lineWidth = 1;
            regions.forEach(r => {
                ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.width, r.height);
            });

            infoEl.textContent = `${page.name} — ${canvas.width}\u00D7${canvas.height}px — ${regions.length} regions`;

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
        canvas.style.maxHeight = 'calc(90vh - 120px)';
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
        canvas.height = canvas.parentElement!.clientHeight || 150;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw checkerboard
        const checkSize = 8;
        for (let y = 0; y < canvas.height; y += checkSize) {
            for (let x = 0; x < canvas.width; x += checkSize) {
                ctx.fillStyle = ((x / checkSize + y / checkSize) % 2 === 0) ? '#ccc' : '#ddd';
                ctx.fillRect(x, y, checkSize, checkSize);
            }
        }

        // Draw region centered
        const scale = Math.min(
            (canvas.width - 20) / region.width,
            (canvas.height - 20) / region.height,
            2
        );
        const drawW = region.width * scale;
        const drawH = region.height * scale;
        const drawX = (canvas.width - drawW) / 2;
        const drawY = (canvas.height - drawH) / 2;

        // Ensure image is loaded
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
