// Authored by forge:snippet-author on 2026-06-13.
export const meta = {
  description: "Add the currently-displayed product to the cart and return the cart badge quantity as a string.",
  preconditions: {
    url: /practicesoftwaretesting\.com\/product\//,
  },
  args: {},
  tags: ['auto-authored'],
}

export async function run(page, args) {
  await page.locator('button[data-test="add-to-cart"]').click();
  await page.locator('[data-test="cart-quantity"]').waitFor();
  return await page.locator('[data-test="cart-quantity"]').textContent();
}
