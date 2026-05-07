import type { APIRoute } from 'astro';
import { AUTH_COOKIE, getAdminPassword } from '../../../lib/auth';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData();
  const password = String(form.get('password') || '');
  const next = String(form.get('next') || '/admin');
  const expected = getAdminPassword();

  if (!expected || password !== expected) {
    return redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  cookies.set(AUTH_COOKIE, '1', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: import.meta.env.PROD,
    maxAge: 60 * 60 * 24 * 30,
  });

  return redirect(next);
};
