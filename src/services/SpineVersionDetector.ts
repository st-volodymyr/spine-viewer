import type { SpineFileSet, SpineVersionInfo } from '../types/spine';

export function detectSpineVersion(fileSet: SpineFileSet): SpineVersionInfo {
    const fullVersion = fileSet.skeleton.format === 'json'
        ? detectFromJson(fileSet.skeleton.data as string)
        : detectFromBinary(fileSet.skeleton.data as Uint8Array);

    const major = fullVersion.startsWith('4.2') ? '4.2'
        : fullVersion.startsWith('4.1') ? '4.1'
        : 'unknown';

    return {
        detected: major,
        fullVersion,
        compatible: major === '4.2' || major === '4.1',
    };
}

function detectFromJson(jsonStr: string): string {
    try {
        const parsed = JSON.parse(jsonStr);
        return parsed.skeleton?.spine ?? parsed.spine ?? '';
    } catch {
        return '';
    }
}

function detectFromBinary(data: Uint8Array): string {
    try {
        let offset = 0;

        function readVarInt(): number {
            let result = 0;
            let shift = 0;
            let byte: number;
            do {
                byte = data[offset++];
                result |= (byte & 0x7F) << shift;
                shift += 7;
            } while (byte & 0x80);
            return result;
        }

        function readString(): string {
            const len = readVarInt();
            if (len === 0) return '';
            const strLen = len - 1;
            const str = new TextDecoder().decode(data.subarray(offset, offset + strLen));
            offset += strLen;
            return str;
        }

        readString(); // skip hash
        const version = readString();
        return version;
    } catch {
        return '';
    }
}
