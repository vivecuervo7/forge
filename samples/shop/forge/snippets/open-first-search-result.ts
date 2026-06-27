// Authored by forge:curator on 2026-06-27.
export const meta = {
  description: "Click the first product card in the search results to open its detail page.",
  args: {},
  tags: ['search', 'product', 'navigate'],
  requires: 'product listing with at least one result visible',
  enters: 'product detail page',
  composes: ['search-for-product'],
}
export async function run(page, args) {
  // Products in the listing carry data-test="product-{uuid}" on the card link.
  // Click the first one to open its detail page.
  await page.locator('[data-test^="product-"]').first().click()
}
