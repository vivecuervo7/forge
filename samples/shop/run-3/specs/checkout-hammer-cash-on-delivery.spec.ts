// Authored by forge:spec-writer on 2026-06-13.
// Reproduces: complete a checkout as customer — buy any hammer, accept the
// auto-populated address, pay with the default payment method (Cash on
// Delivery is easiest), finish on the order confirmation
import { test, expect } from '@playwright/test'

import * as searchForProduct from '../snippets/search-for-product'
import * as openFirstSearchResult from '../snippets/open-first-search-result'
import * as addProductToCart from '../snippets/add-product-to-cart'

test('complete hammer checkout with Cash on Delivery and verify order confirmation', async ({ page }) => {
  // step 1 — invoked
  await searchForProduct.run(page, { query: 'hammer' })

  // step 2 — invoked
  await openFirstSearchResult.run(page, {})

  // step 3 — invoked
  await addProductToCart.run(page, {})

  // step 4 — navigate to checkout and advance past cart review
  await page.goto('https://practicesoftwaretesting.com/checkout')
  await page.locator('[data-test="proceed-1"]').click()

  // step 5 — sign in during checkout (uses input element, not button)
  await page.locator('input[data-test="email"]').fill(process.env.PST_EMAIL ?? '')
  await page.locator('input[data-test="password"]').fill(process.env.PST_PASSWORD ?? '')
  await page.locator('input[data-test="login-submit"]').click()
  await page.getByText('you are already logged in').waitFor()
  await page.locator('[data-test="proceed-2"]').click()

  // step 6 — billing address
  // street + city are pre-populated from the customer's saved profile;
  // country, postal_code, and house_number must be filled manually
  await page.locator('select[data-test="country"]').selectOption('Austria')
  await page.locator('input[data-test="postal_code"]').fill('1010')
  await page.locator('input[data-test="house_number"]').fill('42')
  await page.locator('[data-test="proceed-3"]').click()

  // step 7 — Cash on Delivery payment
  // The finish button requires dispatchEvent('click') due to an Angular
  // zone.js issue; standard .click() silently does nothing.
  // Two-click flow: first reveals "Payment was successful", second reveals
  // #order-confirmation.
  await page.locator('select[data-test="payment-method"]').selectOption('Cash on Delivery')
  await page.locator('[data-test="finish"]').dispatchEvent('click')
  await page.getByText('Payment was successful').waitFor()
  await page.locator('[data-test="finish"]').dispatchEvent('click')
  await page.locator('#order-confirmation').waitFor()

  await expect(page.locator('#order-confirmation')).toContainText('Thanks for your order!')
  await expect(page.locator('#order-confirmation')).toContainText(/INV-\d+/)
})
