// Authored by forge:snippet-author on 2026-06-13.
export const meta = {
  description: "Fill in credentials on the checkout sign-in step (step 2) and proceed to the billing address step. Works whether or not the session is already authenticated.",
  preconditions: {
    url: "https://practicesoftwaretesting.com/checkout",
  },
  args: {},
  envKeys: ['PST_EMAIL', 'PST_PASSWORD'],
  tags: ['auto-authored'],
}

export async function run(page, args) {
  await page.locator('input[data-test="email"]').fill(process.env.PST_EMAIL);
  await page.locator('input[data-test="password"]').fill(process.env.PST_PASSWORD);
  await page.locator('input[data-test="login-submit"]').click();
  await page.locator('button[data-test="proceed-2"]').click();
}
