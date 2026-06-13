// Authored by forge:snippet-author on 2026-06-13.
export const meta = {
  description: "Complete the payment step of checkout and confirm the order, returning the invoice number. Assumes the billing address step (step 3) has already been completed.",
  preconditions: {
    url: "https://practicesoftwaretesting.com/checkout",
  },
  args: {
    paymentMethod: "string — payment method label to select (e.g. 'Cash on Delivery')",
  },
  tags: ['auto-authored'],
}

export async function run(page, args) {
  // Select payment method
  await page.locator('select[data-test="payment-method"]').selectOption(args.paymentMethod);

  // Angular requires dispatchEvent — standard .click() does not fully trigger the event binding
  // First click: processes payment, shows "Payment was successful" message
  await page.locator('button[data-test="finish"]').dispatchEvent('click');
  await page.locator('[data-test="payment-success-message"]').waitFor();

  // Second click: finalises the order, shows order confirmation
  await page.locator('button[data-test="finish"]').dispatchEvent('click');
  await page.locator('#order-confirmation').waitFor();

  // Extract and return the invoice number
  const invoiceNumber = await page.locator('#order-confirmation span').first().textContent();
  return invoiceNumber?.trim();
}
