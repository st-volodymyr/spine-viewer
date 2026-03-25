import { BaseTexture } from '@pixi/core';
import { Cache } from '@electricelephants/pixi-ext';
import { TextureAtlas } from '@esotericsoftware/spine-core';
import {
    SpineTexture,
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
    // Build TextureAtlas using @pixi-spine/base's callback-based API
    const atlas = await new Promise<TextureAtlas41>((resolve) => {
        const a = new TextureAtlas41(fileSet.atlas.data, (pageName, loaderFn) => {
            const tex = fileSet.textures.find(t =>
                t.name === pageName ||
                t.name.toLowerCase() === pageName.toLowerCase()
            );
            if (tex) {
                loaderFn(new BaseTexture(tex.data));
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

    // Build TextureAtlas manually from data URLs
    const atlas = new TextureAtlas(fileSet.atlas.data);

    for (const page of atlas.pages) {
        const tex = fileSet.textures.find(t =>
            t.name === page.name ||
            t.name.toLowerCase() === page.name.toLowerCase()
        );
        if (tex) {
            const baseTex = new BaseTexture(tex.data);
            page.setTexture(SpineTexture.from(baseTex));
        } else {
            console.warn(`SpineParser: texture "${page.name}" not found, available: ${fileSet.textures.map(t => t.name).join(', ')}`);
        }
    }

    const attachmentLoader = new AtlasAttachmentLoader(atlas);
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

    Cache.set(projectName, fileSet.skeleton.format === 'json'
        ? fileSet.skeleton.data as string
        : fileSet.skeleton.data as Uint8Array
    );
    Cache.set(atlasKey, atlas);

    return { runtimeVersion: '4.2', projectName, skeletonData, atlas };
}

export function clearSpineCache(projectName: string): void {
    Cache.remove(projectName);
    Cache.remove(`${projectName}Atlas`);
}
