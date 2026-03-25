import type { TreeNode } from '../types/ui';

export class TreeView {
    element: HTMLElement;
    private searchInput: HTMLInputElement;
    private treeContainer: HTMLElement;
    private nodes: TreeNode[] = [];
    private selectedId: string | null = null;
    private onSelect: ((node: TreeNode) => void) | null = null;

    constructor(options?: { searchable?: boolean; onSelect?: (node: TreeNode) => void }) {
        this.element = document.createElement('div');
        this.element.className = 'sv-tree';
        this.onSelect = options?.onSelect ?? null;

        this.searchInput = document.createElement('input');
        this.searchInput.className = 'sv-tree-search';
        this.searchInput.placeholder = 'Search...';
        this.searchInput.addEventListener('input', () => this.render());
        if (options?.searchable !== false) {
            this.element.appendChild(this.searchInput);
        }

        this.treeContainer = document.createElement('div');
        this.element.appendChild(this.treeContainer);
    }

    setData(nodes: TreeNode[]): void {
        this.nodes = nodes;
        this.render();
    }

    render(): void {
        this.treeContainer.innerHTML = '';
        const filter = this.searchInput.value.toLowerCase();
        const filtered = filter ? this.filterNodes(this.nodes, filter) : this.nodes;
        filtered.forEach(node => {
            this.treeContainer.appendChild(this.renderNode(node, 0));
        });
    }

    private filterNodes(nodes: TreeNode[], filter: string): TreeNode[] {
        const result: TreeNode[] = [];
        for (const node of nodes) {
            const matchesSelf = node.label.toLowerCase().includes(filter);
            const filteredChildren = node.children ? this.filterNodes(node.children, filter) : [];
            if (matchesSelf || filteredChildren.length > 0) {
                result.push({
                    ...node,
                    children: filteredChildren.length > 0 ? filteredChildren : node.children,
                    expanded: matchesSelf ? node.expanded : true,
                });
            }
        }
        return result;
    }

    private renderNode(node: TreeNode, depth: number): HTMLElement {
        const el = document.createElement('div');
        el.className = 'sv-tree-node';

        const row = document.createElement('div');
        row.className = 'sv-tree-node-row';
        if (node.id === this.selectedId) row.classList.add('selected');

        // Toggle
        const toggle = document.createElement('span');
        toggle.className = 'sv-tree-toggle';
        const hasChildren = node.children && node.children.length > 0;
        if (hasChildren) {
            toggle.classList.add('has-children');
            toggle.textContent = node.expanded ? '\u25BC' : '\u25B6';
        }
        row.appendChild(toggle);

        // Icon
        if (node.icon) {
            const icon = document.createElement('span');
            icon.className = 'sv-tree-icon';
            icon.textContent = node.icon;
            row.appendChild(icon);
        }

        // Label
        const label = document.createElement('span');
        label.className = 'sv-tree-label';
        label.textContent = node.label;
        row.appendChild(label);

        // Badge (children count)
        if (hasChildren) {
            const badge = document.createElement('span');
            badge.className = 'sv-tree-badge';
            badge.textContent = String(node.children!.length);
            row.appendChild(badge);
        }

        // Click behavior
        row.addEventListener('click', (e) => {
            e.stopPropagation();
            if (hasChildren) {
                node.expanded = !node.expanded;
                this.render();
            }
            this.selectedId = node.id;
            this.onSelect?.(node);
            this.render();
        });

        el.appendChild(row);

        // Children
        if (hasChildren && node.expanded) {
            const childrenContainer = document.createElement('div');
            childrenContainer.className = 'sv-tree-children';
            node.children!.forEach(child => {
                childrenContainer.appendChild(this.renderNode(child, depth + 1));
            });
            el.appendChild(childrenContainer);
        }

        return el;
    }
}
