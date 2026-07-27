interface TreeNode {
  children: Map<string, TreeNode>;
  file: boolean;
  omitted: boolean;
}

export function buildCodeTree(paths: Array<{ path: string; omitted: boolean }>): string {
  const root: TreeNode = { children: new Map(), file: false, omitted: false };
  for (const item of [...paths].sort((a, b) => a.path.localeCompare(b.path))) {
    const parts = item.path.split("/").filter(Boolean);
    let node = root;
    for (const part of parts) {
      let child = node.children.get(part);
      if (!child) {
        child = { children: new Map(), file: false, omitted: false };
        node.children.set(part, child);
      }
      node = child;
    }
    node.file = true;
    node.omitted = item.omitted;
  }

  const lines: string[] = [];
  const visit = (node: TreeNode, prefix: string) => {
    const entries = [...node.children.entries()].sort(([a, av], [b, bv]) => {
      if (av.file !== bv.file) return av.file ? 1 : -1;
      return a.localeCompare(b);
    });
    entries.forEach(([name, child], index) => {
      const last = index === entries.length - 1;
      lines.push(`${prefix}${last ? "└─ " : "├─ "}${name}${child.file && child.omitted ? " (コード未収録)" : ""}${child.file ? "" : "/"}`);
      visit(child, `${prefix}${last ? "   " : "│  "}`);
    });
  };
  visit(root, "");
  return lines.join("\n");
}
