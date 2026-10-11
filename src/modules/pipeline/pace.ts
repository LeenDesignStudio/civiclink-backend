export function createRequestPacer(
  intervalMs: number,
  clock?: { now(): number; sleep(ms: number): Promise<void> },
): { wait(): Promise<void> } {
  let last = 0;
  return {
    async wait() {
      const current = clock ? clock.now() : Date.now();
      if (last !== 0 && current - last < intervalMs) {
        const gap = intervalMs - (current - last);
        if (clock) await clock.sleep(gap);
        else await new Promise<void>((resolve) => setTimeout(resolve, gap));
      }
      last = clock ? clock.now() : Date.now();
    },
  };
}
