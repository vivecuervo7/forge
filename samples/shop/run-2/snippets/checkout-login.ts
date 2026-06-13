// Authored by forge:snippet-author on 2026-06-13.
export const meta = {
  description: "Advance from the cart/review step into checkout, sign in with env credentials, and proceed to the billing address step.",
  preconditions: {
    url: /practicesoftwaretesting\.com\/checkout/,
  },
  args: {},
  envKeys: ['PST_EMAIL', 'PST_PASSWORD'],
  tags: ['auto-authored'],
}

export async function run(page, args) {
  await page.locator('[data-test="proceed-1"]').click();
  await page.locator('input[data-test="email"]').fill(process.env.PST_EMAIL);
  await page.locator('input[data-test="password"]').fill(process.env.PST_PASSWORD);
  await page.getByRole('button', { name: 'Login' }).click();
  await page.locator('[data-test="proceed-2"]').click();
}
