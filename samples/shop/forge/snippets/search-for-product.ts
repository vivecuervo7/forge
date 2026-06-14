// Authored by forge:snippet-author on 2026-06-15.
export const meta = {
  description: "Fills the search input with a query and submits the form, waiting for results to appear in the product grid.",
  preconditions: {
    url: /practicesoftwaretesting\.com\/?$/,
  },
  args: {
    /** Search query string */
    query: 'string',
  },
  tags: ['auto-authored'],
}

export async function run(page, args) {
  const { query } = args
  if (!query) throw new Error('query arg is required')

  await page.locator('input[data-test="search-query"]').fill(query)
  await page.locator('button[data-test="search-submit"]').click()
  await page.locator('a[data-test^="product-"]').first().waitFor({ state: 'visible' })
}
