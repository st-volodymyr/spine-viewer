import { Application, Container, Graphics, Sprite, Texture } from '@electricelephants/pixi-ext';
import { eventBus } from './EventBus';
import type { StateManager } from './StateManager';

export class Viewport {
    app: Application;
    wrapper: Container;
    private gridGraphics: Graphics;
    private stateManager: StateManager;
    private isPanning = false;
    private lastPointer = { x: 0, y: 0 };
    private refSprite: Sprite | null = null;
    private refAlpha = 0.5;
    private refScale = 1;

    constructor(canvas: HTMLCanvasElement, stateManager: StateManager) {
        this.stateManager = stateManager;

        this.app = new Application({
            view: canvas,
            resizeTo: canvas.parentElement!,
            backgroundColor: this.hexToNumber(stateManager.viewport.bgColor),
            antialias: true,
            resolution: window.devicePixelRatio || 1,
            autoDensity: true,
        });

        (globalThis as any).__PIXI_APP__ = this.app;

        this.wrapper = new Container();
        this.wrapper.sortableChildren = true;
        this.app.stage.addChild(this.wrapper);

        this.gridGraphics = new Graphics();
        this.gridGraphics.zIndex = -1000;
        this.app.stage.addChild(this.gridGraphics);
        this.app.stage.sortableChildren = true;

        this.setupInteraction(canvas);
        this.centerWrapper();
        this.drawGrid();

        eventBus.on('viewport:change', () => {
            this.app.renderer.background.color = this.hexToNumber(stateManager.viewport.bgColor);
            this.drawGrid();
        });

        let prevSize = { width: this.app.screen.width, height: this.app.screen.height };
        const resizeObserver = new ResizeObserver(() => {
            this.app.resize();
            const { width, height } = this.app.screen;
            const dx = (width - prevSize.width) / 2;
            const dy = (height - prevSize.height) / 2;
            if (dx || dy) {
                this.wrapper.x += dx;
                this.wrapper.y += dy;
                this.stateManager.setViewport({ panX: this.wrapper.x, panY: this.wrapper.y });
            }
            prevSize = { width, height };
            this.drawGrid();
        });
        resizeObserver.observe(canvas.parentElement!);
    }

    centerWrapper(): void {
        const { width, height } = this.app.screen;
        this.wrapper.position.set(width / 2, height / 2);
        this.stateManager.setViewport({
            panX: this.wrapper.x,
            panY: this.wrapper.y,
        });
    }

    private setupInteraction(canvas: HTMLCanvasElement): void {
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            const newZoom = Math.max(0.05, Math.min(10, this.wrapper.scale.x * delta));
            this.wrapper.scale.set(newZoom, newZoom);
            this.stateManager.setViewport({ zoom: newZoom });
        }, { passive: false });

        canvas.addEventListener('pointerdown', (e) => {
            if (e.button === 0 || e.button === 1) {
                this.isPanning = true;
                this.lastPointer = { x: e.clientX, y: e.clientY };
                canvas.style.cursor = 'grabbing';
            }
        });

        window.addEventListener('pointermove', (e) => {
            if (!this.isPanning) return;
            const dx = e.clientX - this.lastPointer.x;
            const dy = e.clientY - this.lastPointer.y;
            this.wrapper.x += dx;
            this.wrapper.y += dy;
            this.lastPointer = { x: e.clientX, y: e.clientY };
            this.stateManager.setViewport({
                panX: this.wrapper.x,
                panY: this.wrapper.y,
            });
        });

        window.addEventListener('pointerup', () => {
            if (this.isPanning) {
                this.isPanning = false;
                canvas.style.cursor = 'default';
            }
        });
    }

    private drawGrid(): void {
        this.gridGraphics.clear();
        if (!this.stateManager.viewport.showGrid) return;

        const { width, height } = this.app.screen;
        const gridSize = 50;
        const gridColor = 0x808080;
        const gridAlpha = 0.15;

        this.gridGraphics.lineStyle(1, gridColor, gridAlpha);
        for (let x = 0; x < width; x += gridSize) {
            this.gridGraphics.moveTo(x, 0);
            this.gridGraphics.lineTo(x, height);
        }
        for (let y = 0; y < height; y += gridSize) {
            this.gridGraphics.moveTo(0, y);
            this.gridGraphics.lineTo(width, y);
        }
    }

    private hexToNumber(hex: string): number {
        return parseInt(hex.replace('#', ''), 16);
    }

    get ticker() {
        return this.app.ticker;
    }

    /**
     * Render a display object to a standalone canvas (transparent background),
     * preserving its current pose/scale. Returns null if extraction fails.
     */
    captureObjectCanvas(target: any): HTMLCanvasElement | null {
        if (!target) return null;
        try {
            return this.app.renderer.extract.canvas(target) as HTMLCanvasElement;
        } catch (err) {
            console.error('Frame capture failed:', err);
            return null;
        }
    }

    /**
     * Reference/mockup image drawn in world space behind the skeleton (so it
     * pans/zooms with the content). Pass null to remove.
     */
    setReferenceImage(dataUrl: string | null): void {
        if (this.refSprite) { this.refSprite.destroy(); this.refSprite = null; }
        if (!dataUrl) return;
        const img = new Image();
        img.onload = () => {
            const sprite = new Sprite(Texture.from(img));
            sprite.anchor.set(0.5);
            sprite.zIndex = -500;      // behind the spine (added at zIndex 0), in front of the grid
            sprite.alpha = this.refAlpha;
            sprite.scale.set(this.refScale);
            this.wrapper.addChild(sprite);
            this.refSprite = sprite;
        };
        img.src = dataUrl;
    }

    setReferenceOpacity(alpha: number): void {
        this.refAlpha = alpha;
        if (this.refSprite) this.refSprite.alpha = alpha;
    }

    setReferenceScale(scale: number): void {
        this.refScale = scale;
        if (this.refSprite) this.refSprite.scale.set(scale);
    }

    destroy(): void {
        this.app.destroy(true);
    }
}
