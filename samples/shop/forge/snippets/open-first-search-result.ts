// Authored by forge:snippet-author on 2026-06-15.
export const meta = {
  description: "Clicks the first product card link in the results grid, navigating to that product's detail page.",
  args: {},
  tags: ['navigation'],
  flow: 'shop-checkout',
  phase: 'discover',
  requires: 'home page with search results or default catalog visible',
  enters: 'product detail page (/product/:id)',
}

export async function run(page, args) {
  await page.locator('a[data-test^="product-"]:first-child').click()
}
