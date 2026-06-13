// Authored by forge:snippet-author on 2026-06-13.
export const meta = {
  description: "On the Payment step, selects Cash on Delivery, then performs the required two-click finish sequence (first click processes payment and waits for the success message; second click finalises the order and waits for the order confirmation container).",
  preconditions: {
    url: /practicesoftwaretesting\.com\/checkout/,
  },
  args: {},
  tags: ['auto-authored'],
}

export async function run(page, args) {
  await page.locator('select[data-test="payment-method"]').selectOption('Cash on Delivery');
  // First click: processes payment — Angular zone.js requires dispatchEvent
  await page.locator('[data-test="finish"]').dispatchEvent('click');
  await page.getByText('Payment was successful').waitFor();
  // Second click: finalises order and surfaces #order-confirmation
  await page.locator('[data-test="finish"]').dispatchEvent('click');
  await page.locator('#order-confirmation').waitFor();
}
