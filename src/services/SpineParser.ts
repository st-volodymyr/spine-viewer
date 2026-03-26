import { BaseTexture, ALPHA_MODES, Cache, SpineAtlasLoaderParser } from '@electricelephants/pixi-ext';
import { TextureAtlas } from '@esotericsoftware/spine-core';
import {
    SkeletonJson,
    SkeletonBinary,
    AtlasAttachmentLoader,
} from '@esotericsoftware/spine-pixi-v7';
import type { SkeletonData } from '@esotericsoftware/spine-pixi-v7';

// 4.1 runtime
import {
    TextureAtlas as TextureAtlas41,
    SkeletonBinary as SkeletonBinary41,
    SkeletonJson as SkeletonJson41,
    AtlasAttachmentLoader as AtlasAttachmentLoader41,
} from '@pixi-spine/all-4.1';
import type { SkeletonData as SkeletonData41, Spine as Spine41Type } from '@pixi-spine/all-4.1';

import type { SpineFileSet } from '../types/spine';

export interface ParseResult42 {
    runtimeVersion: '4.2';
    projectName: string;
    skeletonData: SkeletonData;
    atlas: TextureAtlas;
}

export interface ParseResult41 {
    runtimeVersion: '4.1';
    projectName: string;
    skeletonData: SkeletonData41;
    atlas: TextureAtlas41;
}

export type ParseResult = ParseResult42 | ParseResult41;

// Keep Spine41Type accessible for SpineManager
export type { Spine41Type, SkeletonData41 };

let projectCounter = 0;

export async function parseSpineFiles(fileSet: SpineFileSet, spineVersion: '4.1' | '4.2' | 'unknown' = '4.2'): Promise<ParseResult> {
    const projectName = `spineProject_${++projectCounter}`;

    if (spineVersion === '4.1') {
        return parseSpineFiles41(fileSet, projectName);
    }
    return parseSpineFiles42(fileSet, projectName);
}

async function parseSpineFiles41(fileSet: SpineFileSet, projectName: string): Promise<ParseResult41> {
    // Pre-parse atlas text to read page metadata (PMA flags) — avoids TDZ issue
    // where the TextureAtlas41 constructor calls the texture callback synchronously
    // before the `const a = ...` assignment completes.
    const tempAtlas = new TextureAtlas(fileSet.atlas.data);
    const pageMetaMap = new Map(tempAtlas.pages.map(p => [p.name, p]));

    // Build TextureAtlas using @pixi-spine/base's callback-based API
    const atlas = await new Promise<TextureAtlas41>((resolve) => {
        const a = new TextureAtlas41(fileSet.atlas.data, (pageName, loaderFn) => {
            const tex = fileSet.textures.find(t =>
                t.name === pageName ||
                t.name.toLowerCase() === pageName.toLowerCase()
            );
            if (tex) {
                const page = pageMetaMap.get(pageName);
                const alphaMode = page?.pma ? ALPHA_MODES.PMA : ALPHA_MODES.PREMULTIPLY_ON_UPLOAD;
                loaderFn(new BaseTexture(tex.data, { alphaMode }));
            } else {
                console.warn(`SpineParser41: texture "${pageName}" not found, available: ${fileSet.textures.map(t => t.name).join(', ')}`);
                loaderFn(null as any);
            }
        }, (loadedAtlas) => resolve(loadedAtlas ?? a));
        // If no pages trigger the callback (empty atlas), resolve immediately
        if (a.pages.length === 0) resolve(a);
    });

    const attachmentLoader = new AtlasAttachmentLoader41(atlas);
    let skeletonData: SkeletonData41;

    if (fileSet.skeleton.format === 'json') {
        const parser = new SkeletonJson41(attachmentLoader);
        parser.scale = 1;
        skeletonData = parser.readSkeletonData(fileSet.skeleton.data as string);
    } else {
        const parser = new SkeletonBinary41(attachmentLoader);
        parser.scale = 1;
        skeletonData = parser.readSkeletonData(fileSet.skeleton.data as Uint8Array);
    }

    return { runtimeVersion: '4.1', projectName, skeletonData, atlas };
}

async function parseSpineFiles42(fileSet: SpineFileSet, projectName: string): Promise<ParseResult42> {
    const atlasKey = `${projectName}Atlas`;

    // Parse atlas text with spine-core only to read page metadata (PMA flags, page names).
    // We do NOT set textures on this atlas — it is only used to drive the BaseTexture map below.
    const tempAtlas = new TextureAtlas(fileSet.atlas.data);

    // Build a { pageName → BaseTexture } map so SpineAtlasLoaderParser can set pixi-ext-native
    // textures on its own Hp atlas pages without hitting the URL-based loading path.
    const images: Record<string, BaseTexture> = {};
    for (const page of tempAtlas.pages) {
        const tex = fileSet.textures.find(t =>
            t.name === page.name ||
            t.name.toLowerCase() === page.name.toLowerCase()
        );
        if (tex) {
            const alphaMode = page.pma ? ALPHA_MODES.PMA : ALPHA_MODES.PREMULTIPLY_ON_UPLOAD;
            images[page.name] = new BaseTexture(tex.data, { alphaMode });
        } else {
            console.warn(`SpineParser: texture "${page.name}" not found, available: ${fileSet.textures.map(t => t.name).join(', ')}`);
        }
    }

    // Use pixi-ext's own SpineAtlasLoaderParser to create a native Hp atlas.
    // When options.data.images contains a BaseTexture for a page, the parser calls
    // page.setTexture(Rp.from(baseTexture)) directly, producing Gp (TextureAtlasRegion)
    // instances that pass the `instanceof Gp` check inside SpineElement's updateRegion().
    // This ensures UV rotation (atlas packing) is handled correctly for all attachments.
    const pixiExtAtlas = await (SpineAtlasLoaderParser as any).loader.parse(
        fileSet.atlas.data,
        { src: '', data: { images } },
        // Fallback loader — only called for pages missing from `images`.
        // Returns { baseTexture } because the loader callback does: t => mh.from(t.baseTexture)
        { load: async () => ({ baseTexture: new BaseTexture() }) }
    );

    // Cache the pixi-ext atlas and raw skeleton data for SpineElement.changeSkeleton().
    Cache.set(projectName, fileSet.skeleton.format === 'json'
        ? fileSet.skeleton.data as string
        : fileSet.skeleton.data as Uint8Array
    );
    Cache.set(atlasKey, pixiExtAtlas);

    // Also parse skeleton data with spine-pixi-v7 for the return value (used to read
    // animation/skin names before SpineElement is constructed).
    const attachmentLoader = new AtlasAttachmentLoader(tempAtlas);
    let skeletonData: SkeletonData;

    if (fileSet.skeleton.format === 'json') {
        const parser = new SkeletonJson(attachmentLoader);
        parser.scale = 1;
        skeletonData = parser.readSkeletonData(fileSet.skeleton.data as string);
    } else {
        const parser = new SkeletonBinary(attachmentLoader);
        parser.scale = 1;
        skeletonData = parser.readSkeletonData(fileSet.skeleton.data as Uint8Array);
    }

    return { runtimeVersion: '4.2', projectName, skeletonData, atlas: tempAtlas };
}

export function clearSpineCache(projectName: string): void {
    Cache.remove(projectName);
    Cache.remove(`${projectName}Atlas`);
}
