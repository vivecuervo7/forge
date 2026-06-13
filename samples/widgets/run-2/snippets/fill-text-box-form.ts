// Authored by forge:snippet-author on 2026-06-13.
export const meta = {
  description: "Navigate to demoqa.com/text-box and fill all four form fields, then submit.",
  args: {
    name: "string",           // full name, e.g. 'Jane Smith'
    email: "string",          // email address
    currentAddress: "string", // current address text
    permanentAddress: "string", // permanent address text
  },
  tags: ['auto-authored'],
}

export async function run(page, args) {
  await page.goto('https://demoqa.com/text-box');
  await page.locator('#userName').fill(args.name);
  await page.locator('#userEmail').fill(args.email);
  await page.locator('#currentAddress').fill(args.currentAddress);
  await page.locator('#permanentAddress').fill(args.permanentAddress);
  await page.locator('#submit').scrollIntoViewIfNeeded();
  await page.locator('#submit').click();
}
