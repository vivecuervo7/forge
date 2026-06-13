// Authored by forge:snippet-author on 2026-06-13.
export const meta = {
  description: "Clicks the first product card on the current search results page, navigating to that product's detail page.",
  preconditions: {
    url: /practicesoftwaretesting\.com/,
  },
  args: {},
  tags: ['auto-authored'],
}

export async function run(page, args) {
  await page.locator('a[data-test^="product-"]:first-of-type').click();
}
