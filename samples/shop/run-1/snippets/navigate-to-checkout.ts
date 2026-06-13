// Authored by forge:snippet-author on 2026-06-13.
export const meta = {
  description: "Navigate to the checkout page and advance past the cart summary step (step 1) to reach the sign-in step (step 2). Assumes at least one item is already in the cart.",
  args: {},
  tags: ['auto-authored'],
}

export async function run(page, args) {
  await page.goto('https://practicesoftwaretesting.com/checkout');
  await page.locator('button[data-test="proceed-1"]').click();
}
