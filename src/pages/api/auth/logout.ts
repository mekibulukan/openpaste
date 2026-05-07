import type { APIRoute } from 'astro';
import { AUTH_COOKIE } from '../../../lib/auth';

export const POST: APIRoute = async ({ cookies, redirect }) => {
  cookies.delete(AUTH_COOKIE, { path: '/' });
  return redirect('/');
};
