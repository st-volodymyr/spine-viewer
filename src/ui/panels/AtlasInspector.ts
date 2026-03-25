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
        this.element.style.height = '100%';
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
        this.regionList.style.flex = '1';
        this.regionList.style.overflow = 'auto';
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

    private drawPreview(region: AtlasRegion): void {
        const img = this.textureImages.get(region.page);
        if (!img) return;

        const canvas = this.previewCanvas;
        const ctx = this.previewCtx;
        canvas.width = canvas.parentElement!.clientWidth;
        canvas.height = canvas.parentElement!.clientHeight;

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
