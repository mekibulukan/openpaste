export const AUTH_COOKIE = 'boss_blog_auth';

export function getAdminPassword() {
  return import.meta.env.BLOG_ADMIN_PASSWORD || process.env.BLOG_ADMIN_PASSWORD || '';
}

export function isAuthenticated(cookies: AstroCookies | { get: (name: string) => { value: string } | undefined }) {
  const cookie = cookies.get(AUTH_COOKIE)?.value;
  return cookie === '1';
}
