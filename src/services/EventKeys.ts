/**
 * Static event keyframes per animation, read straight from SkeletonData.
 * Duck-typed (an EventTimeline is any timeline with an `events` array) so it
 * works for both the 4.1 and 4.2 runtimes and survives minification.
 */
export interface EventKey {
    /** Key time in seconds. */
    time: number;
    name: string;
    int: number;
    float: number;
    string: string;
    audio: string;
}

export type EventKeyMap = Map<string, EventKey[]>;

export function collectEventKeys(skeletonData: any): EventKeyMap {
    const result: EventKeyMap = new Map();
    const animations: any[] = skeletonData?.animations ?? [];
    for (const anim of animations) {
        const keys: EventKey[] = [];
        for (const t of anim.timelines ?? []) {
            if (!Array.isArray(t?.events)) continue;
            for (const e of t.events) {
                if (!e) continue;
                keys.push({
                    time: e.time ?? 0,
                    name: e.data?.name ?? '',
                    int: e.intValue ?? 0,
                    float: e.floatValue ?? 0,
                    string: e.stringValue ?? '',
                    audio: e.data?.audioPath ?? '',
                });
            }
        }
        keys.sort((a, b) => a.time - b.time);
        result.set(anim.name, keys);
    }
    return result;
}
