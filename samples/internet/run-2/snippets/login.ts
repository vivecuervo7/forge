// Authored by forge:snippet-author on 2026-06-13.
export const meta = {
  description: "Navigate to the-internet /login and sign in with the given credentials, landing on the Secure Area page.",
  args: {
    username: "string — login username (default: 'tomsmith')",
    password: "string — login password (default: 'SuperSecretPassword!')",
  },
  tags: ['auto-authored'],
}

export async function run(page, args) {
  const username = args.username ?? 'tomsmith';
  const password = args.password ?? 'SuperSecretPassword!';
  await page.goto('https://the-internet.herokuapp.com/login');
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.locator('button[type="submit"]').click();
}
