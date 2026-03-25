export interface AtlasPage {
    name: string;
    width: number;
    height: number;
    format: string;
    filter: string;
    repeat: string;
}

export interface AtlasRegion {
    name: string;
    page: string;
    x: number;
    y: number;
    width: number;
    height: number;
    originalWidth: number;
    originalHeight: number;
    offsetX: number;
    offsetY: number;
    rotate: boolean | number;
    index: number;
}

export interface ParsedAtlas {
    pages: AtlasPage[];
    regions: AtlasRegion[];
}

export function parseAtlasText(atlasText: string): ParsedAtlas {
    const pages: AtlasPage[] = [];
    const regions: AtlasRegion[] = [];
    const lines = atlasText.split(/\r?\n/);

    let currentPage: AtlasPage | null = null;
    let currentRegion: Partial<AtlasRegion> | null = null;
    let i = 0;

    while (i < lines.length) {
        const line = lines[i].trim();
        i++;

        if (line === '') {
            // Blank line = new page coming
            currentRegion = null;
            continue;
        }

        // Check if this is a page header (no leading whitespace and no colon, or has size/format next)
        if (!lines[i - 1].startsWith(' ') && !lines[i - 1].startsWith('\t')) {
            // Look ahead: if next line has "size:" or "format:", this is a page name
            const nextLine = i < lines.length ? lines[i].trim() : '';
            if (nextLine.startsWith('size:') || nextLine.startsWith('format:') || nextLine.startsWith('filter:')) {
                currentPage = {
                    name: line,
                    width: 0,
                    height: 0,
                    format: '',
                    filter: '',
                    repeat: '',
                };
                pages.push(currentPage);
                currentRegion = null;
                continue;
            }

            // This could be a region name
            if (currentPage) {
                if (currentRegion) {
                    // Save previous region
                    regions.push(currentRegion as AtlasRegion);
                }
                currentRegion = {
                    name: line,
                    page: currentPage.name,
                    x: 0, y: 0,
                    width: 0, height: 0,
                    originalWidth: 0, originalHeight: 0,
                    offsetX: 0, offsetY: 0,
                    rotate: false,
                    index: -1,
                };
            }
            continue;
        }

        // Property line
        const colonIdx = line.indexOf(':');
        if (colonIdx < 0) continue;

        const key = line.substring(0, colonIdx).trim();
        const value = line.substring(colonIdx + 1).trim();

        if (currentRegion) {
            // Region property
            switch (key) {
                case 'bounds':
                case 'xy': {
                    const parts = value.split(',').map(s => parseInt(s.trim()));
                    if (parts.length >= 2) {
                        currentRegion.x = parts[0];
                        currentRegion.y = parts[1];
                    }
                    if (parts.length >= 4) {
                        currentRegion.width = parts[2];
                        currentRegion.height = parts[3];
                    }
                    break;
                }
                case 'size': {
                    if (currentPage && currentPage.width === 0) {
                        // This is page size
                        const parts = value.split(',').map(s => parseInt(s.trim()));
                        currentPage.width = parts[0];
                        currentPage.height = parts[1];
                    } else {
                        const parts = value.split(',').map(s => parseInt(s.trim()));
                        currentRegion.width = parts[0];
                        currentRegion.height = parts[1];
                    }
                    break;
                }
                case 'orig': {
                    const parts = value.split(',').map(s => parseInt(s.trim()));
                    currentRegion.originalWidth = parts[0];
                    currentRegion.originalHeight = parts[1];
                    break;
                }
                case 'offset': {
                    const parts = value.split(',').map(s => parseInt(s.trim()));
                    currentRegion.offsetX = parts[0];
                    currentRegion.offsetY = parts[1];
                    break;
                }
                case 'rotate':
                    currentRegion.rotate = value === 'true' || value === '90';
                    break;
                case 'index':
                    currentRegion.index = parseInt(value);
                    break;
            }
        } else if (currentPage) {
            // Page property
            switch (key) {
                case 'size': {
                    const parts = value.split(',').map(s => parseInt(s.trim()));
                    currentPage.width = parts[0];
                    currentPage.height = parts[1];
                    break;
                }
                case 'format':
                    currentPage.format = value;
                    break;
                case 'filter':
                    currentPage.filter = value;
                    break;
                case 'repeat':
                    currentPage.repeat = value;
                    break;
            }
        }
    }

    // Push last region
    if (currentRegion && currentRegion.name) {
        regions.push(currentRegion as AtlasRegion);
    }

    return { pages, regions };
}
