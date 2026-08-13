// Real accounts via Firebase Authentication — email/password and Google.
// Uses the same Firebase project as the leaderboard (see leaderboard.js for
// the FIREBASE_CONFIG + Firestore setup notes).
//
// ---------------------------------------------------------------------------
// SETUP (in the same Firebase project you already made for the leaderboard):
// ---------------------------------------------------------------------------
// 1. console.firebase.google.com -> your project -> Build -> Authentication
//    -> "Get started".
// 2. Sign-in method tab -> Email/Password -> Enable -> Save.
// 3. Sign-in method tab -> Google -> Enable -> pick a support email -> Save.
// 4. Authentication -> Settings tab -> Authorized domains -> "Add domain"
//    -> add whatever domain you host the game on (e.g. your GitHub Pages
//    domain, like "yourname.github.io"). Without this, Google sign-in will
//    fail on that domain. localhost is already allowed for local testing.
// That's it — no config values to copy here, it reuses FIREBASE_CONFIG from
// leaderboard.js automatically.
// ---------------------------------------------------------------------------

import { getFirebaseApp, isOnlineLeaderboardConfigured } from './leaderboard.js';

let authMod = null;
let auth = null;
let initPromise = null;
let currentUser = null;
const listeners = [];

export function isAuthConfigured() {
  return isOnlineLeaderboardConfigured();
}

async function init() {
  if (!isAuthConfigured()) return null;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const app = await getFirebaseApp();
      if (!app) return null;
      authMod = await import('https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js');
      auth = authMod.getAuth(app);
      authMod.onAuthStateChanged(auth, (user) => {
        currentUser = user;
        listeners.forEach((cb) => { try { cb(user); } catch (e) { console.error(e); } });
      });
      // Finish a Google redirect sign-in if we just came back from one.
      try { await authMod.getRedirectResult(auth); } catch (e) { /* no pending redirect */ }
      return auth;
    } catch (err) {
      console.warn('Auth: Firebase failed to load.', err);
      return null;
    }
  })();
  return initPromise;
}

// Fires immediately with the current user (may be null), then on every
// sign-in/sign-out. Returns nothing to unsubscribe with — this app only
// ever needs one global listener for the account UI.
export async function onAuthChange(cb) {
  listeners.push(cb);
  await init();
  cb(currentUser);
}

export function getCurrentUser() {
  return currentUser;
}

function friendlyError(err) {
  const code = (err && err.code) || '';
  if (code.includes('wrong-password') || code.includes('invalid-credential')) return 'WRONG EMAIL OR PASSWORD';
  if (code.includes('user-not-found')) return 'NO ACCOUNT WITH THAT EMAIL';
  if (code.includes('email-already-in-use')) return 'EMAIL ALREADY REGISTERED — TRY SIGNING IN';
  if (code.includes('weak-password')) return 'PASSWORD TOO SHORT (6+ CHARACTERS)';
  if (code.includes('invalid-email')) return 'ENTER A VALID EMAIL';
  if (code.includes('popup-closed-by-user')) return 'SIGN-IN CANCELLED';
  if (code.includes('network-request-failed')) return 'NO INTERNET CONNECTION';
  return 'SOMETHING WENT WRONG — TRY AGAIN';
}

export async function signUpEmail(email, password, displayName) {
  await init();
  if (!auth) return { ok: false, error: 'ACCOUNTS NOT SET UP YET' };
  try {
    const cred = await authMod.createUserWithEmailAndPassword(auth, email, password);
    if (displayName) await authMod.updateProfile(cred.user, { displayName: displayName.toUpperCase().slice(0, 12) });
    return { ok: true, user: cred.user };
  } catch (err) {
    return { ok: false, error: friendlyError(err) };
  }
}

export async function signInEmail(email, password) {
  await init();
  if (!auth) return { ok: false, error: 'ACCOUNTS NOT SET UP YET' };
  try {
    const cred = await authMod.signInWithEmailAndPassword(auth, email, password);
    return { ok: true, user: cred.user };
  } catch (err) {
    return { ok: false, error: friendlyError(err) };
  }
}

// Redirect-based (not popup) — far more reliable on mobile browsers, which
// often block or lose popups. The page will navigate away to Google and
// back; onAuthChange fires once it returns.
export async function signInGoogle() {
  await init();
  if (!auth) return { ok: false, error: 'ACCOUNTS NOT SET UP YET' };
  try {
    const provider = new authMod.GoogleAuthProvider();
    await authMod.signInWithRedirect(auth, provider);
    return { ok: true, redirecting: true };
  } catch (err) {
    return { ok: false, error: friendlyError(err) };
  }
}

export async function signOutUser() {
  await init();
  if (!auth) return;
  try { await authMod.signOut(auth); } catch (e) { /* ignore */ }
}
