// Use the current browser origin, not the old site's domain or path.
export function authRedirectUrl(origin: string, base: string) {
  return new URL(base, origin).href
}
