// _wait-until-stable.ts — shared settle primitive (scaffolded by /forge init).
//
// Poll a read until it stops changing: N consecutive identical reads within a
// deadline. One stable read is NOT stability — async-mutation UIs (deferred
// command buses, re-rendering grids, optimistic updates) routinely show a
// false plateau that a single read latches onto; requiring a streak is what
// makes this reliable.
//
// This is a PRIMITIVE, not a snippet: underscore-prefixed files in snippets/
// carry no `meta` block, don't appear in the INDEX, and are imported by
// snippets and specs rather than invoked. Compose it wherever a value needs
// to settle before it's trusted:
//
//   import { waitUntilStable } from './_wait-until-stable'
//   const count = await waitUntilStable(() => page.locator('[data-row]').count())
//   const total = await waitUntilStable(() => page.locator('#total').innerText(), { consecutive: 4 })

export interface WaitUntilStableOptions {
  /** How many consecutive identical reads count as stable. */
  consecutive?: number
  /** Delay between reads, in ms. */
  intervalMs?: number
  /** Overall deadline, in ms. */
  timeoutMs?: number
}

export async function waitUntilStable<T>(
  read: () => Promise<T>,
  { consecutive = 3, intervalMs = 250, timeoutMs = 10_000 }: WaitUntilStableOptions = {},
): Promise<T> {
  let last: string | undefined
  let lastValue!: T
  let streak = 0
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await read()
    const key = JSON.stringify(value)
    streak = key === last ? streak + 1 : 1
    last = key
    lastValue = value
    if (streak >= consecutive) return value
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(
    `waitUntilStable: no ${consecutive} consecutive stable reads within ${timeoutMs}ms ` +
      `(last value: ${JSON.stringify(lastValue)?.slice(0, 120)})`,
  )
}
