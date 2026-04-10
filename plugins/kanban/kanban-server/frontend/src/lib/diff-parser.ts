export interface DiffHunk {
  header: string;
  lines: { type: "add" | "del" | "ctx"; content: string; oldNum: number | null; newNum: number | null }[];
}

export interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export function parseDiff(raw: string): DiffFile[] {
  if (!raw) return [];
  const files: DiffFile[] = [];
  const fileSections = raw.split(/^diff --git /m).filter(Boolean);

  for (const section of fileSections) {
    const lines = section.split("\n");
    const headerMatch = lines[0]?.match(/a\/(.+?) b\/(.+)/);
    if (!headerMatch) continue;

    const path = headerMatch[2];
    let additions = 0;
    let deletions = 0;
    const hunks: DiffHunk[] = [];
    let currentHunk: DiffHunk | null = null;
    let oldNum = 0;
    let newNum = 0;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith("@@")) {
        const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
        if (match) {
          oldNum = parseInt(match[1]);
          newNum = parseInt(match[2]);
          currentHunk = { header: line, lines: [] };
          hunks.push(currentHunk);
        }
        continue;
      }

      if (!currentHunk) continue;
      if (line.startsWith("\\")) continue;

      if (line.startsWith("+")) {
        additions++;
        currentHunk.lines.push({ type: "add", content: line.slice(1), oldNum: null, newNum: newNum++ });
      } else if (line.startsWith("-")) {
        deletions++;
        currentHunk.lines.push({ type: "del", content: line.slice(1), oldNum: oldNum++, newNum: null });
      } else {
        currentHunk.lines.push({ type: "ctx", content: line.slice(1), oldNum: oldNum++, newNum: newNum++ });
      }
    }

    files.push({ path, additions, deletions, hunks });
  }

  return files;
}

export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
  file?: DiffFile;
  additions: number;
  deletions: number;
}

export function buildFileTree(files: DiffFile[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const file of files) {
    const parts = file.path.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isLast = i === parts.length - 1;
      const existing = current.find((n) => n.name === name);

      if (existing) {
        if (isLast) {
          existing.file = file;
          existing.additions += file.additions;
          existing.deletions += file.deletions;
        } else {
          current = existing.children;
          existing.additions += file.additions;
          existing.deletions += file.deletions;
        }
      } else {
        const node: TreeNode = {
          name,
          path: parts.slice(0, i + 1).join("/"),
          isDir: !isLast,
          children: [],
          file: isLast ? file : undefined,
          additions: file.additions,
          deletions: file.deletions,
        };
        current.push(node);
        if (!isLast) current = node.children;
      }
    }
  }

  function sort(nodes: TreeNode[]) {
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) if (n.children.length) sort(n.children);
  }
  sort(root);

  return root;
}
