// Authored by forge:snippet-author on 2026-06-13.
export const meta = {
  description: "Navigate to the-internet /javascript_alerts, handle the JS Confirm dialog (accept or dismiss), click the button, and return the result text.",
  args: {
    dialogAction: "string — 'accept' or 'dismiss'; defaults to 'accept'",
  },
  tags: ['auto-authored'],
}

export async function run(page, args) {
  const action = args.dialogAction ?? 'accept';
  await page.goto('https://the-internet.herokuapp.com/javascript_alerts');
  // Wire the dialog listener BEFORE clicking — the alert blocks if you click first.
  page.once('dialog', d => action === 'dismiss' ? d.dismiss() : d.accept());
  await page.locator('button:has-text("Click for JS Confirm")').click();
  return await page.locator('#result').innerText();
}
