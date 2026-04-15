export class UnionFind {
  private readonly parent = new Map<string, string>();

  add(value: string): void {
    if (!this.parent.has(value)) {
      this.parent.set(value, value);
    }
  }

  find(value: string): string {
    const current = this.parent.get(value);
    if (!current) {
      this.parent.set(value, value);
      return value;
    }

    if (current === value) {
      return value;
    }

    const root = this.find(current);
    this.parent.set(value, root);
    return root;
  }

  union(left: string, right: string): string {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot === rightRoot) {
      return leftRoot;
    }

    const nextRoot = leftRoot < rightRoot ? leftRoot : rightRoot;
    const merged = nextRoot === leftRoot ? rightRoot : leftRoot;
    this.parent.set(merged, nextRoot);
    return nextRoot;
  }
}
