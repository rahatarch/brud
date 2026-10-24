export class KeyedWriteMutex {
  private readonly tails = new Map<string, Promise<void>>();

  async runExclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
    if (key.length === 0) {
      throw new Error('KeyedWriteMutex requires a non-empty key');
    }

    const previous = this.tails.get(key) ?? Promise.resolve();
    const run = previous.then(() => task());
    const tail = run.then(
      () => undefined,
      () => undefined,
    );

    this.tails.set(key, tail);

    try {
      return await run;
    } finally {
      if (this.tails.get(key) === tail) {
        this.tails.delete(key);
      }
    }
  }

  clear(): void {
    this.tails.clear();
  }
}
