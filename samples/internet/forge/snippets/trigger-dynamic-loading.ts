// Authored by forge:snippet-author on 2026-06-15.
export const meta = {
  description: "Navigate to a dynamic-loading variant, click Start, wait for the hidden element to appear, and return its rendered text.",
  args: {
    variant: "/** 1 | 2 — which dynamic-loading example to use */ number",
    baseURL: "/** base URL of the site */ string",
  },
  tags: ['probe', 'variant'],
  enters: 'dynamic-loading page with finish element visible',
}

export async function run(page, args) {
  const { variant = 1, baseURL = 'https://the-internet.herokuapp.com' } = args

  await page.goto(`${baseURL}/dynamic_loading/${variant}`)
  await page.locator('button:has-text("Start")').click()
  await page.waitForSelector('#finish h4', { state: 'visible', timeout: 10000 })
  return await page.locator('#finish h4').textContent()
}
