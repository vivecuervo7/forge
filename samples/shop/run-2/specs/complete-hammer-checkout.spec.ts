// Authored by forge:spec-writer on 2026-06-13.
// Reproduces: complete a checkout as customer — buy any hammer, accept the auto-populated address, pay with the default payment method, finish on the order confirmation
import { test, expect } from '@playwright/test'

import * as searchForProduct from '../snippets/search-for-product'
import * as openFirstSearchResult from '../snippets/open-first-search-result'
import * as addProductToCart from '../snippets/add-product-to-cart'
import * as checkoutLogin from '../snippets/checkout-login'
import * as checkoutFillAddress from '../snippets/checkout-fill-address'
import * as checkoutSelectPaymentAndConfirm from '../snippets/checkout-select-payment-and-confirm'

test('complete hammer purchase through checkout to order confirmation', async ({ page }) => {
  // step 1 — invoked
  await searchForProduct.run(page, { query: 'hammer' })

  // step 2 — invoked
  await openFirstSearchResult.run(page, {})

  // step 3 — invoked
  const badgeCount = await addProductToCart.run(page, {})
  expect(badgeCount).toBe('1')

  // step 4 — navigate to cart (fresh: single nav click)
  await page.locator('a[data-test="nav-cart"]').click()

  // step 5+6 — invoked: proceed-1 → sign in → proceed-2
  await checkoutLogin.run(page, {})

  // step 7 — invoked: fill required billing fields → proceed-3
  await checkoutFillAddress.run(page, {
    country: 'Austria',
    postalCode: '1010',
    houseNumber: '98',
    state: 'Vienna',
  })

  // step 8+9 — invoked: select payment, confirm twice, returns confirmation text
  const confirmationText = await checkoutSelectPaymentAndConfirm.run(page, {
    paymentMethod: 'Cash on Delivery',
  })
  expect(confirmationText).toMatch(/Thanks for your order!/)
  expect(confirmationText).toMatch(/INV-\d+/)
})
