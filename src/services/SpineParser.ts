import { BaseTexture, Cache } from '@electricelephants/pixi-ext';
import { TextureAtlas } from '@esotericsoftware/spine-core';
import {
    SpineTexture,
    SkeletonJson,
    SkeletonBinary,
    AtlasAttachmentLoader,
} from '@esotericsoftware/spine-pixi-v7';
import type { SkeletonData } from '@esotericsoftware/spine-pixi-v7';
import type { SpineFileSet } from '../types/spine';

export interface ParseResult {
    skeletonData: SkeletonData;
    atlas: TextureAtlas;
    projectName: string;
}

let projectCounter = 0;

export async function parseSpineFiles(fileSet: SpineFileSet): Promise<ParseResult> {
    const projectName = `spineProject_${++projectCounter}`;
    const atlasKey = `${projectName}Atlas`;

    // 1. Build TextureAtlas manually from raw text + data URLs
    const atlas = new TextureAtlas(fileSet.atlas.data);

    for (const page of atlas.pages) {
        // Find matching texture by page name
        const tex = fileSet.textures.find(t =>
            t.name === page.name ||
            t.name.toLowerCase() === page.name.toLowerCase()
        );
        if (tex) {
            const baseTex = BaseTexture.from(tex.data);
            page.setTexture(SpineTexture.from(baseTex));
        } else {
            console.warn(`SpineParser: texture "${page.name}" not found, available: ${fileSet.textures.map(t => t.name).join(', ')}`);
        }
    }

    // 2. Parse skeleton data
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

    // 3. Cache for SpineElement.changeSkeleton — it calls Assets.get(name) and Assets.get(nameAtlas)
    Cache.set(projectName, fileSet.skeleton.format === 'json'
        ? fileSet.skeleton.data as string
        : fileSet.skeleton.data as Uint8Array
    );
    Cache.set(atlasKey, atlas);

    return { skeletonData, atlas, projectName };
}

export function clearSpineCache(projectName: string): void {
    Cache.remove(projectName);
    Cache.remove(`${projectName}Atlas`);
}
