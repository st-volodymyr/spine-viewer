import type { SkeletonData } from '@electricelephants/pixi-ext';
import type { TreeNode } from '../types/ui';

export function introspectSkeleton(data: SkeletonData): {
    bones: TreeNode[];
    slots: TreeNode[];
    skins: TreeNode[];
    events: TreeNode[];
    animations: TreeNode[];
    constraints: TreeNode[];
    info: Record<string, string>;
} {
    return {
        bones: buildBoneTree(data),
        slots: buildSlotList(data),
        skins: buildSkinTree(data),
        events: buildEventList(data),
        animations: buildAnimationList(data),
        constraints: buildConstraintList(data),
        info: buildInfo(data),
    };
}

function buildBoneTree(data: SkeletonData): TreeNode[] {
    const boneMap = new Map<string, TreeNode>();

    // Create nodes for all bones
    for (const bone of data.bones) {
        boneMap.set(bone.name, {
            id: `bone:${bone.name}`,
            label: bone.name,
            icon: '\u{1F9B4}',
            children: [],
            expanded: bone.name === 'root',
            data: {
                type: 'bone',
                x: bone.x,
                y: bone.y,
                rotation: bone.rotation,
                scaleX: bone.scaleX,
                scaleY: bone.scaleY,
                length: bone.length,
            },
        });
    }

    // Build hierarchy
    const roots: TreeNode[] = [];
    for (const bone of data.bones) {
        const node = boneMap.get(bone.name)!;
        if (bone.parent) {
            const parent = boneMap.get(bone.parent.name);
            if (parent) {
                parent.children!.push(node);
            } else {
                roots.push(node);
            }
        } else {
            roots.push(node);
        }
    }

    return roots;
}

function buildSlotList(data: SkeletonData): TreeNode[] {
    return data.slots.map(slot => ({
        id: `slot:${slot.name}`,
        label: slot.name,
        icon: '\u{1F4E6}',
        data: {
            type: 'slot',
            boneName: slot.boneData.name,
            attachmentName: slot.attachmentName ?? '(none)',
            blendMode: slot.blendMode,
            color: slot.color ? `r:${slot.color.r.toFixed(2)} g:${slot.color.g.toFixed(2)} b:${slot.color.b.toFixed(2)} a:${slot.color.a.toFixed(2)}` : '',
        },
    }));
}

function buildSkinTree(data: SkeletonData): TreeNode[] {
    return data.skins.map(skin => {
        const attachments: TreeNode[] = [];
        // Iterate skin attachments
        const allEntries = skin.getAttachments();
        for (const entry of allEntries) {
            if (entry.attachment) {
                const slotName = entry.slotIndex < data.slots.length
                    ? data.slots[entry.slotIndex].name
                    : `slot_${entry.slotIndex}`;
                attachments.push({
                    id: `skin:${skin.name}:${slotName}:${entry.name}`,
                    label: `${slotName} / ${entry.name}`,
                    icon: '\u{1F3A8}',
                    data: {
                        type: 'skinAttachment',
                        slotName,
                        attachmentName: entry.name,
                        attachmentType: entry.attachment.constructor.name,
                    },
                });
            }
        }

        return {
            id: `skin:${skin.name}`,
            label: skin.name,
            icon: '\u{1F3A8}',
            children: attachments,
            expanded: false,
            data: {
                type: 'skin',
                attachmentCount: attachments.length,
            },
        };
    });
}

function buildEventList(data: SkeletonData): TreeNode[] {
    return data.events.map(event => ({
        id: `event:${event.name}`,
        label: event.name,
        icon: '\u26A1',
        data: {
            type: 'event',
            intValue: event.intValue,
            floatValue: event.floatValue,
            stringValue: event.stringValue,
            audioPath: event.audioPath ?? '',
        },
    }));
}

function buildAnimationList(data: SkeletonData): TreeNode[] {
    return data.animations.map(anim => ({
        id: `anim:${anim.name}`,
        label: anim.name,
        icon: '\u25B6',
        data: {
            type: 'animation',
            duration: anim.duration,
            timelines: anim.timelines.length,
        },
    }));
}

function buildConstraintList(data: SkeletonData): TreeNode[] {
    const nodes: TreeNode[] = [];

    for (const ik of data.ikConstraints) {
        nodes.push({
            id: `ik:${ik.name}`,
            label: `IK: ${ik.name}`,
            icon: '\u{1F517}',
            data: {
                type: 'ikConstraint',
                targetBone: ik.target.name,
                bones: ik.bones.map(b => b.name).join(', '),
                mix: ik.mix,
                softness: ik.softness,
                bendPositive: ik.bendDirection > 0,
            },
        });
    }

    for (const tc of data.transformConstraints) {
        nodes.push({
            id: `transform:${tc.name}`,
            label: `Transform: ${tc.name}`,
            icon: '\u{1F504}',
            data: {
                type: 'transformConstraint',
                targetBone: tc.target.name,
                bones: tc.bones.map(b => b.name).join(', '),
            },
        });
    }

    for (const pc of data.pathConstraints) {
        nodes.push({
            id: `path:${pc.name}`,
            label: `Path: ${pc.name}`,
            icon: '\u{1F6E4}',
            data: {
                type: 'pathConstraint',
                target: pc.target.name,
                bones: pc.bones.map(b => b.name).join(', '),
            },
        });
    }

    return nodes;
}

function buildInfo(data: SkeletonData): Record<string, string> {
    return {
        'Name': data.name ?? '(unnamed)',
        'Version': data.version ?? '(unknown)',
        'Hash': data.hash ?? '',
        'Width': String(data.width),
        'Height': String(data.height),
        'Bones': String(data.bones.length),
        'Slots': String(data.slots.length),
        'Skins': String(data.skins.length),
        'Animations': String(data.animations.length),
        'Events': String(data.events.length),
        'IK Constraints': String(data.ikConstraints.length),
        'Transform Constraints': String(data.transformConstraints.length),
        'Path Constraints': String(data.pathConstraints.length),
    };
}
