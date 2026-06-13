// Authored by forge:snippet-author on 2026-06-13.
export const meta = {
  description: "Navigates to demoqa.com/modal-dialogs, opens a modal by size, captures its title and body text, then closes it.",
  args: {
    /** 'small' or 'large' */
    size: 'string',
  },
  tags: ['auto-authored'],
}

export async function run(page, args) {
  const sizeId = args.size.charAt(0).toUpperCase() + args.size.slice(1);
  await page.goto('https://demoqa.com/modal-dialogs');
  await page.locator(`button[id='show${sizeId}Modal']`).click();
  const title = await page.locator('.modal-title').textContent();
  const body = await page.locator('.modal-body').textContent();
  await page.locator(`button[id='close${sizeId}Modal']`).click();
  return { title: title?.trim(), body: body?.trim() };
}
