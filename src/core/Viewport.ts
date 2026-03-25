import { Application, Container, Graphics } from '@electricelephants/pixi-ext';
import { eventBus } from './EventBus';
import type { StateManager } from './StateManager';

export class Viewport {
    app: Application;
    wrapper: Container;
    private gridGraphics: Graphics;
    private stateManager: StateManager;
    private isPanning = false;
    private lastPointer = { x: 0, y: 0 };

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

        const resizeObserver = new ResizeObserver(() => {
            this.app.resize();
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
        const gridColor = 0x999999;
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

    destroy(): void {
        this.app.destroy(true);
    }
}
