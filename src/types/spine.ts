export interface SpineFileSet {
    skeleton: { name: string; data: string | Uint8Array; format: 'json' | 'binary' };
    atlas: { name: string; data: string };
    textures: Array<{ name: string; data: string }>;
    archiveName?: string;
}

export interface SpineVersionInfo {
    detected: '4.1' | '4.2' | 'unknown';
    fullVersion: string;
    compatible: boolean;
}

export interface TrackState {
    index: number;
    animationName: string | null;
    loop: boolean;
    timeScale: number;
}

export interface AnimationQueueItem {
    animationName: string;
    loop: boolean;
    delay: number;
}
