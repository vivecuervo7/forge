// Authored by forge:snippet-author on 2026-06-13.
export const meta = {
  description: "Navigate to the-internet login page and sign in with the given username and password, landing on /secure.",
  args: {
    username: { type: 'string', description: 'Login username' },
    password: { type: 'string', description: 'Login password' },
  },
  tags: ['auto-authored'],
}

export async function run(page, args) {
  await page.goto('https://the-internet.herokuapp.com/login');
  await page.locator('#username').fill(args.username);
  await page.locator('#password').fill(args.password);
  await page.locator('button:has-text("Login")').click();
}
