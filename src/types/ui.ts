export interface TreeNode {
    id: string;
    label: string;
    icon?: string;
    children?: TreeNode[];
    data?: Record<string, unknown>;
    expanded?: boolean;
    selected?: boolean;
}

export interface PanelConfig {
    id: string;
    title: string;
    icon: string;
    collapsed: boolean;
    minWidth: number;
}
