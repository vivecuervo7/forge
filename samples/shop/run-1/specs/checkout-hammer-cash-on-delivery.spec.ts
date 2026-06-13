// Authored by forge:spec-writer on 2026-06-13.
// Reproduces: complete a checkout as customer — buy any hammer, accept the auto-populated address, pay with the default payment method, finish on the order confirmation
import { test, expect } from '@playwright/test'

import * as searchProducts from '../snippets/search-products'
import * as addProductToCart from '../snippets/add-product-to-cart'

test('complete checkout buying a hammer with Cash on Delivery and confirm order', async ({ page }) => {
  // step 1 — invoked: search for hammer
  await searchProducts.run(page, { query: 'hammer' })

  // step 2 — invoked: add Claw Hammer with Shock Reduction Grip to cart
  await addProductToCart.run(page, { productUrl: 'https://practicesoftwaretesting.com/product/01KTZBASJSPFXXAWRD3N6GZWDG' })

  // step 3 — navigate to checkout
  await page.goto('https://practicesoftwaretesting.com/checkout')

  // step 4 — proceed past cart review (step 1)
  await page.locator('button[data-test="proceed-1"]').click()

  // step 5 — sign in at checkout (step 2)
  await page.locator('input[data-test="email"]').fill(process.env.PST_EMAIL ?? '')
  await page.locator('input[data-test="password"]').fill(process.env.PST_PASSWORD ?? '')
  await page.locator('input[data-test="login-submit"]').click()
  await page.locator('button[data-test="proceed-2"]').waitFor({ state: 'visible' })
  await page.locator('button[data-test="proceed-2"]').click()

  // step 6 — billing address (step 3): street + city pre-populate from account profile;
  //           country, house_number, postal_code, state must be supplied explicitly
  await page.locator('select[data-test="country"]').selectOption('Austria')
  await page.locator('input[data-test="house_number"]').fill('98')
  await page.locator('input[data-test="postal_code"]').fill('1000')
  await page.locator('input[data-test="state"]').fill('Vienna')
  await page.locator('button[data-test="proceed-3"]').click()

  // step 7 — payment (step 4): Cash on Delivery needs no extra fields.
  //   NOTE: button[data-test="finish"] requires dispatchEvent('click') — standard .click()
  //   triggers the DOM event but Angular's zone.js doesn't detect it. Two clicks with
  //   explicit waits between: first → payment API called → "Payment was successful";
  //   Angular needs ~800ms to settle before the second click triggers order creation.
  await page.locator('select[data-test="payment-method"]').selectOption('Cash on Delivery')
  await page.locator('button[data-test="finish"]').dispatchEvent('click')
  await page.locator('[data-test="payment-success-message"]').waitFor()
  await page.waitForTimeout(800)
  await page.locator('button[data-test="finish"]').dispatchEvent('click')
  await page.locator('#order-confirmation').waitFor()

  // assert order confirmation — invoice number must match INV-\d+
  const invoiceSpan = page.locator('#order-confirmation span')
  await expect(invoiceSpan).toHaveText(/INV-\d+/)
})
