// Authored by forge:snippet-curator on 2026-06-27.
export const meta = {
  description: "Fill the search box and submit to filter the product listing.",
  args: { query: { type: 'string', description: 'search term to enter' } },
  tags: ['search', 'product', 'filter'],
  flow: 'browse', phase: 'search',
  enters: 'product listing filtered by query',
}
export async function run(page, args) {
  const { query } = args
  if (!query) throw new Error('query arg is required')
  await page.locator('input[data-test=\'search-query\']').click()
  await page.locator('input[data-test=\'search-query\']').fill(query)
  await page.locator('button[data-test=\'search-submit\']').click()
}
