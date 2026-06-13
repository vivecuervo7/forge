// Authored by forge:snippet-author on 2026-06-13.
export const meta = {
  description: "Navigates to /checkout, advances past the cart-review step, fills login credentials, submits, and advances past the sign-in step — leaving the browser on the Billing Address step.",
  envKeys: ['PST_EMAIL', 'PST_PASSWORD'],
  args: {},
  tags: ['auto-authored'],
}

export async function run(page, args) {
  await page.goto('https://practicesoftwaretesting.com/checkout');
  await page.locator('[data-test="proceed-1"]').click();
  await page.locator('input[data-test="email"]').fill(process.env.PST_EMAIL);
  await page.locator('input[data-test="password"]').fill(process.env.PST_PASSWORD);
  await page.locator('input[data-test="login-submit"]').click();
  await page.locator('[data-test="proceed-2"]').click();
}
