import type { User } from "@netlify/identity";

import {
  AUTH_ENABLED,
  completeInvite,
  completeRecovery,
  describeAuthError,
  resolveSession,
  sendRecoveryEmail,
  signIn,
  signOut,
} from "./auth.ts";

/**
 * The sign-in gate: a full-screen overlay that stays up until there's a session.
 * All DOM and no policy, the counterpart to `auth.ts` — same split as
 * `cats-ui.ts` and `cats.ts`.
 *
 * The overlay ships visible in `index.html` and is removed from here, rather
 * than the reverse, so that a slow or failed module load errs towards showing
 * nothing. While it's up, every other top-level element is marked `inert`, which
 * keeps the app behind it out of the tab order and away from screen readers
 * instead of merely painting over it.
 */

type ViewName = "signin" | "invite" | "recovery" | "forgot";

const gate = requireEl<HTMLElement>("#auth-gate");
const lede = requireEl<HTMLParagraphElement>("#auth-lede");
const errorEl = requireEl<HTMLParagraphElement>("#auth-error");
const noticeEl = requireEl<HTMLParagraphElement>("#auth-notice");
const account = requireEl<HTMLElement>("#account");
const accountEmail = requireEl<HTMLElement>("#account-email");
const signOutButton = requireEl<HTMLButtonElement>("#sign-out");

const views: Record<ViewName, HTMLFormElement> = {
  signin: requireEl<HTMLFormElement>("#auth-view-signin"),
  invite: requireEl<HTMLFormElement>("#auth-view-invite"),
  recovery: requireEl<HTMLFormElement>("#auth-view-recovery"),
  forgot: requireEl<HTMLFormElement>("#auth-view-forgot"),
};

const emailInput = requireEl<HTMLInputElement>("#auth-email");
const passwordInput = requireEl<HTMLInputElement>("#auth-password");
const invitePassword = requireEl<HTMLInputElement>("#auth-invite-password");
const recoveryPassword = requireEl<HTMLInputElement>("#auth-recovery-password");
const forgotEmail = requireEl<HTMLInputElement>("#auth-forgot-email");

let settle: ((user: User) => void) | null = null;
let inviteToken: string | null = null;
/**
 * Set when the gate reappears mid-session (see `lockScreen`). By then `main.ts`
 * is holding charts, listeners and a half-loaded dataset built under the old
 * session, so signing back in reloads rather than trying to resume — much less
 * to get wrong than re-entering the boot path.
 */
let reloadOnSuccess = false;

/**
 * Resolve once there's a user to render for. Returns `null` when auth is turned
 * off (local dev), which is the caller's cue to skip the account UI entirely.
 */
export async function openAuthGate(): Promise<User | null> {
  if (!AUTH_ENABLED) {
    closeGate();
    return null;
  }

  showGate();
  const session = await resolveSession();

  switch (session.kind) {
    case "disabled":
      closeGate();
      return null;
    case "authenticated":
      adopt(session.user);
      return session.user;
    case "invited":
      inviteToken = session.token;
      lede.textContent =
        "You've been invited to Chonkwatch. Pick a password to finish setting up your account.";
      showView("invite");
      break;
    case "recovering":
      lede.textContent = "Choose a new password for your account.";
      showView("recovery");
      break;
    case "anonymous":
      showView("signin");
      break;
  }

  return new Promise<User>((resolve) => {
    settle = resolve;
  });
}

/**
 * Put the gate back up after the server stopped accepting the session. Called
 * from the API layer on a 401, which is the first moment the app can actually
 * tell that a token went stale.
 */
export function lockScreen(message: string): void {
  if (!AUTH_ENABLED || !gate.hidden) return;
  reloadOnSuccess = true;
  lede.textContent = "Your session has expired.";
  showView("signin");
  showNotice(message);
  showGate();
}

views.signin.addEventListener("submit", (event) => {
  event.preventDefault();
  void attempt(
    views.signin,
    async () => {
      adopt(await signIn(emailInput.value.trim(), passwordInput.value));
    },
    "That email and password didn't match.",
  );
});

views.invite.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!inviteToken) {
    showError("This invite link is no longer valid. Ask for a fresh one.");
    return;
  }
  const token = inviteToken;
  void attempt(
    views.invite,
    async () => {
      adopt(await completeInvite(token, invitePassword.value));
    },
    "That invite link has expired or has already been used.",
  );
});

views.recovery.addEventListener("submit", (event) => {
  event.preventDefault();
  void attempt(
    views.recovery,
    async () => {
      adopt(await completeRecovery(recoveryPassword.value));
    },
    "That reset link has expired. Request a new one.",
  );
});

views.forgot.addEventListener("submit", (event) => {
  event.preventDefault();
  void attempt(
    views.forgot,
    async () => {
      await sendRecoveryEmail(forgotEmail.value.trim());
      showView("signin");
      showNotice("Check your email for a link to reset your password.");
    },
    "Couldn't send the reset email.",
  );
});

requireEl<HTMLButtonElement>("#auth-forgot-link").addEventListener(
  "click",
  () => {
    forgotEmail.value = emailInput.value;
    lede.textContent = "We'll email you a link to set a new password.";
    showView("forgot");
  },
);

requireEl<HTMLButtonElement>("#auth-back-link").addEventListener("click", () => {
  lede.textContent = "Sign in to see Jasper & Enzo.";
  showView("signin");
});

signOutButton.addEventListener("click", () => {
  void (async () => {
    signOutButton.disabled = true;
    try {
      await signOut();
    } catch (err) {
      // The cookies are cleared locally either way, so a failed round-trip
      // still ends the session as far as this browser is concerned.
      console.warn("[auth-ui] Sign-out request failed.", err);
    }
    location.reload();
  })();
});

/** Take a freshly authenticated user: drop the gate and fill in the account bar. */
function adopt(user: User): void {
  if (reloadOnSuccess) {
    location.reload();
    return;
  }
  accountEmail.textContent = user.email ?? "";
  account.hidden = false;
  closeGate();
  settle?.(user);
  settle = null;
}

/**
 * Run one submission with the busy/error bookkeeping every form needs. The
 * fallback message stands in for Identity's own wording, which is written for
 * machines — a bad password comes back as a bare 400.
 */
async function attempt(
  form: HTMLFormElement,
  run: () => Promise<void>,
  fallback: string,
): Promise<void> {
  clearMessages();
  setBusy(form, true);
  try {
    await run();
  } catch (err) {
    showError(describeAuthError(err, fallback));
  } finally {
    setBusy(form, false);
  }
}

function showView(name: ViewName): void {
  clearMessages();
  for (const [key, form] of Object.entries(views)) {
    form.hidden = key !== name;
  }
  const focusable = views[name].querySelector<HTMLInputElement>("input");
  focusable?.focus();
}

function setBusy(form: HTMLFormElement, busy: boolean): void {
  for (const el of form.querySelectorAll<HTMLElement>("input, button")) {
    (el as HTMLInputElement | HTMLButtonElement).disabled = busy;
  }
  form.classList.toggle("is-busy", busy);
}

function showError(message: string): void {
  errorEl.textContent = message;
  errorEl.hidden = false;
  noticeEl.hidden = true;
}

function showNotice(message: string): void {
  noticeEl.textContent = message;
  noticeEl.hidden = false;
  errorEl.hidden = true;
}

function clearMessages(): void {
  errorEl.hidden = true;
  noticeEl.hidden = true;
}

function showGate(): void {
  gate.hidden = false;
  setAppInert(true);
}

function closeGate(): void {
  gate.hidden = true;
  setAppInert(false);
  clearMessages();
}

/**
 * Neutralize everything except the gate. Applied to whatever else is in `body`
 * rather than a fixed list, so a new top-level element doesn't quietly become
 * reachable from behind the overlay.
 */
function setAppInert(inert: boolean): void {
  for (const el of Array.from(document.body.children)) {
    if (el === gate || !(el instanceof HTMLElement)) continue;
    el.inert = inert;
  }
}

function requireEl<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing required element: ${selector}`);
  return el;
}
