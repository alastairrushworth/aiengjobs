/** Run `fn` over `items` with at most `concurrency` in flight; returns results in
 *  original order. Used for the ingest posting loop and connectors that need an
 *  N+1 detail fetch (e.g. Workable) without hammering the upstream API. */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
  return results;
}
