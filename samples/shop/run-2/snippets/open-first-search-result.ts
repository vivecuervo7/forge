// Authored by forge:snippet-author on 2026-06-13.
export const meta = {
  description: "Click the first product card in the current listing or search results grid to open its detail page.",
  preconditions: {
    url: /practicesoftwaretesting\.com/,
  },
  args: {},
  tags: ['auto-authored'],
}

export async function run(page, args) {
  await page.locator('a[data-test^="product-"]').first().click();
}
