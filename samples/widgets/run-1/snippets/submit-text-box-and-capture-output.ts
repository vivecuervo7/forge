// Authored by forge:snippet-author on 2026-06-13.
export const meta = {
  description: "Submit the DemoQA Text Box form and return the rendered output panel text. Precondition: form fields are already filled.",
  preconditions: {
    url: 'https://demoqa\\.com/text-box',
  },
  args: {},
  tags: ['auto-authored'],
}

export async function run(page, args) {
  await page.locator('#submit').click();
  await page.locator('#output').waitFor({ state: 'visible' });
  return await page.locator('#output').innerText();
}
