// Authored by forge:snippet-curator on 2026-06-27. Patched 2026-06-27: navigate to the catalog before searching (the snippet failed when invoked from /account after a login redirect). Patched 2026-06-27: wait for at least one product card after submit — the search box has a 300ms debounce and an async network call; open-first-search-result would otherwise click a stale card.
export const meta = {
  description: "Navigate to the product catalog and search by keyword to filter the listing.",
  args: { query: { type: 'string', description: 'search term to enter' } },
  tags: ['search', 'product', 'filter', 'catalog'],
  flow: 'browse', phase: 'search',
  requires: 'authenticated or guest session',
  enters: 'product listing filtered by query',
}
export async function run(page, args) {
  const { query } = args
  if (!query) throw new Error('query arg is required')
  await page.goto('https://practicesoftwaretesting.com/')
  await page.locator('input[data-test=\'search-query\']').click()
  await page.locator('input[data-test=\'search-query\']').fill(query)
  await page.locator('button[data-test=\'search-submit\']').click()
  await page.locator('[data-test^="product-"]').first().waitFor({ state: 'visible' })
}
