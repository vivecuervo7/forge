// Authored by forge:snippet-author on 2026-06-13.
export const meta = {
  description: "Select a payment method on the checkout payment step and click Confirm twice (first confirms payment, second finalises the order), returning the order confirmation text.",
  preconditions: {
    url: /practicesoftwaretesting\.com\/checkout/,
  },
  args: {
    paymentMethod: "string", // payment method label, e.g. "Cash on Delivery", "Credit Card", "Bank Transfer"
  },
  tags: ['auto-authored'],
}

export async function run(page, args) {
  await page.locator('[data-test="payment-method"]').selectOption(args.paymentMethod);
  await page.getByRole('button', { name: 'Confirm' }).click();
  await page.getByText(/Payment was successful/).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Confirm' }).click();
  return await page.getByText(/Thanks for your order/).textContent();
}
