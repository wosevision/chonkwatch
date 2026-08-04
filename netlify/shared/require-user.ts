import { getUser } from "@netlify/identity";

/**
 * Netlify Identity guard shared by the `/api/csvs` and `/api/cats` functions.
 *
 * This is the app's actual access control. The sign-in gate in the browser
 * (`src/auth-ui.ts`) only decides whether to paint the UI; it can be skipped by
 * anyone willing to open devtools or curl the endpoint directly. These two
 * functions are the only doors to the data, so they're the ones that have to be
 * locked.
 *
 * Deliberately *not* in `netlify/functions/`: every file at the top of that
 * directory is deployed as its own function, so a helper placed there would
 * become a public endpoint. The esbuild bundler follows the relative import
 * from here regardless.
 *
 * `getUser()` fails closed. On the server it validates the caller's `nf_jwt`
 * against Identity's `/user` endpoint and returns `null` on anything it doesn't
 * like — a forged cookie, an expired token, an unreachable Identity service.
 * It never throws.
 */
export async function requireUser(): Promise<Response | null> {
  const user = await getUser();
  if (user) return null;

  return new Response(JSON.stringify({ error: "Not signed in" }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      // Never let an intermediary hold on to a response derived from someone's
      // session, in either direction.
      "Cache-Control": "private, no-store",
    },
  });
}
