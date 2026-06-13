// Authored by forge:snippet-author on 2026-06-13.
export const meta = {
  description: "Clicks the add-to-cart button on the current product detail page and waits for the success toast to confirm the item was added.",
  preconditions: {
    url: /practicesoftwaretesting\.com\/product\//,
  },
  args: {},
  tags: ['auto-authored'],
}

export async function run(page, args) {
  await page.locator('button[data-test="add-to-cart"]').click();
  await page.locator('[role="alert"]').waitFor();
}
