import JSZip from 'jszip';
import type { SpineFileSet } from '../types/spine';

const SKELETON_EXTS = ['.json', '.skel'];
const ATLAS_EXTS = ['.atlas'];
const TEXTURE_EXTS = ['.png', '.jpg', '.jpeg', '.avif', '.webp'];

function getExtension(name: string): string {
    const idx = name.lastIndexOf('.');
    return idx >= 0 ? name.substring(idx).toLowerCase() : '';
}

function getFileName(path: string): string {
    return path.split('/').pop()?.split('\\').pop() ?? path;
}

function isSkeleton(name: string): boolean {
    return SKELETON_EXTS.includes(getExtension(name));
}

function isAtlas(name: string): boolean {
    return ATLAS_EXTS.includes(getExtension(name));
}

function isTexture(name: string): boolean {
    return TEXTURE_EXTS.includes(getExtension(name));
}

function isSpineArchive(name: string): boolean {
    return getExtension(name) === '.spine';
}

function getMimeType(name: string): string {
    const ext = getExtension(name);
    const map: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.avif': 'image/avif',
        '.webp': 'image/webp',
    };
    return map[ext] ?? 'image/png';
}

async function readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsText(file);
    });
}

async function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}

async function readFileAsDataURL(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function loadFromSpineArchive(file: File): Promise<SpineFileSet> {
    const zip = await JSZip.loadAsync(await readFileAsArrayBuffer(file));
    const entries = Object.values(zip.files).filter(f => !f.dir);

    let skeleton: SpineFileSet['skeleton'] | null = null;
    let atlas: SpineFileSet['atlas'] | null = null;
    const textures: SpineFileSet['textures'] = [];

    for (const entry of entries) {
        const name = getFileName(entry.name);
        if (isSkeleton(name)) {
            const isBinary = getExtension(name) === '.skel';
            if (isBinary) {
                const data = await entry.async('uint8array');
                skeleton = { name, data, format: 'binary' };
            } else {
                const data = await entry.async('string');
                skeleton = { name, data, format: 'json' };
            }
        } else if (isAtlas(name)) {
            const data = await entry.async('string');
            atlas = { name, data };
        } else if (isTexture(name)) {
            const blob = await entry.async('blob');
            const dataUrl = await blobToDataURL(new Blob([blob], { type: getMimeType(name) }));
            textures.push({ name, data: dataUrl });
        }
    }

    if (!skeleton) throw new Error('No skeleton file (.json or .skel) found in archive');
    if (!atlas) throw new Error('No atlas file (.atlas) found in archive');

    return { skeleton, atlas, textures, archiveName: file.name };
}

function blobToDataURL(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

export async function loadSpineFiles(files: FileList | File[]): Promise<SpineFileSet> {
    const fileArray = Array.from(files);

    // Check if it's a single .spine archive
    if (fileArray.length === 1 && isSpineArchive(fileArray[0].name)) {
        return loadFromSpineArchive(fileArray[0]);
    }

    let skeleton: SpineFileSet['skeleton'] | null = null;
    let atlas: SpineFileSet['atlas'] | null = null;
    const textures: SpineFileSet['textures'] = [];

    for (const file of fileArray) {
        const name = getFileName(file.name);
        if (isSkeleton(name) && !skeleton) {
            const isBinary = getExtension(name) === '.skel';
            if (isBinary) {
                const data = new Uint8Array(await readFileAsArrayBuffer(file));
                skeleton = { name, data, format: 'binary' };
            } else {
                const data = await readFileAsText(file);
                skeleton = { name, data, format: 'json' };
            }
        } else if (isAtlas(name) && !atlas) {
            const data = await readFileAsText(file);
            atlas = { name, data };
        } else if (isTexture(name)) {
            const data = await readFileAsDataURL(file);
            textures.push({ name, data });
        }
    }

    if (!skeleton) throw new Error('No skeleton file (.json or .skel) found');
    if (!atlas) throw new Error('No atlas file (.atlas) found');
    if (textures.length === 0) throw new Error('No texture files found');

    return { skeleton, atlas, textures };
}

export function createFileInput(multiple: boolean, onFiles: (files: FileList) => void, folder = false): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple;
    if (folder) {
        input.setAttribute('webkitdirectory', '');
    } else {
        input.accept = '.json,.skel,.atlas,.png,.jpg,.jpeg,.avif,.webp,.spine';
    }
    input.addEventListener('change', () => {
        if (input.files && input.files.length > 0) {
            onFiles(input.files);
        }
    });
    return input;
}

export function setupDragDrop(
    element: HTMLElement,
    onFiles: (files: FileList) => void,
): void {
    element.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        element.classList.add('sv-drag-over');
    });
    element.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        element.classList.remove('sv-drag-over');
    });
    element.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        element.classList.remove('sv-drag-over');
        if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
            onFiles(e.dataTransfer.files);
        }
    });
}
