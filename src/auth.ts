import {
  AuthError,
  acceptInvite,
  getUser,
  handleAuthCallback,
  login,
  logout,
  requestPasswordRecovery,
  updateUser,
  type User,
} from "@netlify/identity";

/**
 * Session adapter over Netlify Identity. Owns no DOM — `auth-ui.ts` renders the
 * gate and calls in here, mirroring the `cats.ts` / `cats-ui.ts` split.
 *
 * The app is invite-only, so there is deliberately no signup path: accounts are
 * created by inviting them from the Netlify dashboard, and the only way in is
 * the emailed invite link (`{ kind: "invited" }` below) followed by a password.
 *
 * Worth being clear about what this module is and isn't. The gate it backs is a
 * *convenience* — it keeps the UI from rendering for a stranger. The actual
 * access control lives in `netlify/functions/{csvs,cats}.ts`, which re-check the
 * session server-side and 401 without it. Nothing here can be trusted, because
 * all of it runs on the visitor's machine.
 */

/**
 * Identity only exists on a deployed Netlify site: `npm run dev` is plain Vite,
 * so `/.netlify/identity` isn't there to talk to and a gate would just lock the
 * owner out of their own dev server. The library is no help in deciding this —
 * in a browser it unconditionally reports Identity as configured at
 * `${location.origin}/.netlify/identity` — so key off the build mode instead,
 * which is at least deterministic.
 *
 * Set `VITE_FORCE_AUTH=true` to exercise the real flow locally under
 * `netlify dev`. Note that `npm run preview` is a PROD build, so it shows the
 * gate too, and can't get past it without a Netlify runtime behind it.
 */
export const AUTH_ENABLED: boolean =
  import.meta.env.PROD || import.meta.env.VITE_FORCE_AUTH === "true";

export type Session =
  /** Local dev: no Identity to talk to, so the app runs open. */
  | { kind: "disabled" }
  | { kind: "anonymous" }
  | { kind: "authenticated"; user: User }
  /** Arrived on an invite link; needs to choose a password before they exist. */
  | { kind: "invited"; token: string }
  /** Arrived on a recovery link; already signed in but must set a new password. */
  | { kind: "recovering" };

/**
 * Work out where the visitor stands, once, at startup.
 *
 * Order matters: the URL hash is checked before the stored session, because
 * someone following an invite or recovery link has an intent that outranks
 * whatever cookie they happen to be carrying. `handleAuthCallback` strips the
 * hash as it consumes it, so a refresh mid-flow lands on the normal sign-in
 * form rather than replaying a spent token.
 */
export async function resolveSession(): Promise<Session> {
  if (!AUTH_ENABLED) return { kind: "disabled" };

  const callback = await handleAuthCallback().catch((err: unknown) => {
    // A dead link shouldn't strand the visitor on a broken screen; fall
    // through to the sign-in form, which they can still use.
    console.warn("[auth] Could not process the link you followed.", err);
    return null;
  });

  if (callback?.type === "invite" && callback.token) {
    return { kind: "invited", token: callback.token };
  }
  if (callback?.type === "recovery") {
    return { kind: "recovering" };
  }

  const user = await getUser();
  return user ? { kind: "authenticated", user } : { kind: "anonymous" };
}

export async function signIn(email: string, password: string): Promise<User> {
  return login(email, password);
}

/** Redeem an invite token and set the account's first password. */
export async function completeInvite(
  token: string,
  password: string,
): Promise<User> {
  return acceptInvite(token, password);
}

/**
 * Set a new password during recovery. `handleAuthCallback` has already signed
 * the user in by this point, so this is an update to the live session rather
 * than a token redemption.
 */
export async function completeRecovery(password: string): Promise<User> {
  return updateUser({ password });
}

export async function sendRecoveryEmail(email: string): Promise<void> {
  return requestPasswordRecovery(email);
}

export async function signOut(): Promise<void> {
  await logout();
}

/**
 * Turn a library error into something worth showing a human. Identity reports
 * bad credentials as a 400 with a terse machine-facing message, which reads as
 * a bug rather than a typo.
 */
export function describeAuthError(err: unknown, fallback: string): string {
  if (err instanceof AuthError) {
    if (err.status === 400 || err.status === 401) return fallback;
    if (err.status === 422) {
      return "That password was rejected. Try a longer one.";
    }
    if (err.status === 429) {
      return "Too many attempts. Wait a minute and try again.";
    }
    return err.message || fallback;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
