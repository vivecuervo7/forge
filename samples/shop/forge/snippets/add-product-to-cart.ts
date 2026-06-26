// Authored by forge:snippet-curator on 2026-06-27.
export const meta = {
  description: "Click the Add to Cart button on a product detail page.",
  args: {},
  tags: ['cart', 'add', 'product'],
  requires: 'product detail page',
  enters: 'product added to shopping cart (toast confirms)',
}
export async function run(page, args) {
  await page.locator('button[data-test=\'add-to-cart\']').click()
}
