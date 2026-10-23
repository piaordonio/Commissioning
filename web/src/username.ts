// Supabase Auth is email/password under the hood -- there's no first-class
// "username" provider -- so a chosen username is mapped to a synthetic
// address under a reserved, never-resolving domain (.invalid is set aside
// for exactly this by RFC 2606) instead of a real inbox. Nothing is ever
// sent to it, so Supabase's "Confirm email" project setting must be turned
// off for sign-up to complete -- a real confirmation link can never reach
// an address that doesn't exist.
const USERNAME_DOMAIN = "accounts.commissioning.invalid";
const USERNAME_PATTERN = /^[a-z0-9._-]+$/;

export function toLoginEmail(username: string): string {
  const normalized = username.trim().toLowerCase();
  if (normalized.length < 2 || normalized.length > 40 || !USERNAME_PATTERN.test(normalized)) {
    throw new Error("Username must be 2-40 characters: letters, numbers, dots, underscores, or hyphens only.");
  }
  return `${normalized}@${USERNAME_DOMAIN}`;
}

export function fromLoginEmail(email: string): string {
  const suffix = `@${USERNAME_DOMAIN}`;
  return email.endsWith(suffix) ? email.slice(0, -suffix.length) : email;
}
