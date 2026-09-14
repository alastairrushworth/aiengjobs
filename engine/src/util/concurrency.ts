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

/** When `guardedPool` gives up on a board: this many detail attempts have
 *  thrown, and they are at least this share of the attempts completed so far.
 *
 *  Five at a quarter trips on the first five in a row — a dead endpoint costs
 *  about two minutes at four in flight (each failure is fetchRetry's full three
 *  timeouts), against the 40 minutes Intertek's Workable board spent on
 *  2026-09-14 for 250 fetches that mostly hung. A healthy board with the odd
 *  single timeout never gets near it. */
export const BREAKER_MIN_FAILURES = 5;
export const BREAKER_FAILURE_RATE = 0.25;

/** Wraps one detail fetch-and-parse; resolves undefined instead of throwing. */
export type Attempt = <A>(work: () => Promise<A>) => Promise<A | undefined>;

/**
 * `mapPool` for the N+1 detail fetches a listing needs, with a circuit breaker.
 *
 * Every connector with a detail step already degrades a posting to its list
 * row when that one fetch fails, which is right for a single blip and wrong for
 * an endpoint that is refusing us: 250 postings then cost 250 × three timeouts,
 * the board comes back with no descriptions, and the classifier re-reads every
 * title-only advert each night as its content hash flips.
 *
 * `fn` receives an `attempt` beside each item. Wrap the fetch-and-parse of one
 * detail in it and the posting degrades exactly as before — but the failure is
 * counted, and once failures reach {@link BREAKER_MIN_FAILURES} at
 * {@link BREAKER_FAILURE_RATE} the pool stops scheduling, lets what is in
 * flight finish, and rejects. The feed then counts as failed for the night —
 * yesterday's roles stay, descriptions intact — and the board is named in the
 * end-of-run failure list. Only thrown attempts count: a 404 on a role that
 * closed between list and detail is instant and legitimate.
 */
export async function guardedPool<T, R>(
  items: T[],
  concurrency: number,
  label: string,
  fn: (item: T, attempt: Attempt) => Promise<R>,
): Promise<R[]> {
  let completed = 0;
  let failures = 0;
  let tripped = false;
  const attempt: Attempt = async (work) => {
    if (tripped) return undefined;
    try {
      const v = await work();
      completed++;
      return v;
    } catch {
      completed++;
      failures++;
      if (failures >= BREAKER_MIN_FAILURES && failures >= completed * BREAKER_FAILURE_RATE) {
        tripped = true;
      }
      return undefined;
    }
  };

  const results = new Array<R>(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length && !tripped) {
      const idx = i++;
      results[idx] = await fn(items[idx], attempt);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
  if (tripped) {
    throw new Error(
      `${label}: detail fetches failing (${failures} of ${completed} threw), gave up after ${i} of ${items.length}`,
    );
  }
  return results;
}
