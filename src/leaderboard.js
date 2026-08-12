// Shared online leaderboard, backed by Firebase Firestore so every player,
// on any device, can see (and appear on) the same high score table.
//
// ---------------------------------------------------------------------------
// SETUP (one-time, ~5 minutes) — Jemz, do this before the leaderboard works:
// ---------------------------------------------------------------------------
// 1. Go to https://console.firebase.google.com -> "Add project" (free plan
//    is plenty). You can reuse your Lexigo project if you'd rather not make
//    a new one — just use a different collection name below if so.
// 2. In the project: Build -> Firestore Database -> "Create database" ->
//    start in PRODUCTION mode (we set our own rules below), pick any region.
// 3. Project settings (gear icon) -> General -> "Your apps" -> Add app ->
//    Web (</>) -> register it (no need for hosting) -> copy the
//    `firebaseConfig` object it gives you -> paste it into FIREBASE_CONFIG
//    below, replacing the placeholder values.
// 4. Firestore -> Rules tab -> replace the rules with the block below this
//    comment, then hit Publish. This lets anyone submit/read scores, but
//    blocks them from editing or deleting existing ones, and sanity-checks
//    the shape of new scores (no auth needed — fine for a hobby game):
//
//    rules_version = '2';
//    service cloud.firestore {
//      match /databases/{database}/documents {
//        match /scores/{scoreId} {
//          allow read: if true;
//          allow create: if request.resource.data.keys().hasAll(
//              ['name','score','lines','difficulty','mode','ts'])
//            && request.resource.data.name is string
//            && request.resource.data.name.size() <= 12
//            && request.resource.data.score is int
//            && request.resource.data.score >= 0
//            && request.resource.data.score <= 9999999
//            && request.resource.data.ts == request.time;
//          allow update, delete: if false;
//        }
//      }
//    }
//
// 5. Reload the game. Until step 3+4 are done, the leaderboard silently
//    falls back to device-local scores only — nothing breaks.
// ---------------------------------------------------------------------------

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCEQq4d3jVaYYlSRyRY8JQcfWVNSk0wVgA',
  authDomain: 'jemz-tetris.firebaseapp.com',
  projectId: 'jemz-tetris',
  storageBucket: 'jemz-tetris.firebasestorage.app',
  messagingSenderId: '1082495166730',
  appId: '1:1082495166730:web:2d77b7ead7da29ef3af2f3'
};

const COLLECTION = 'jemzTetrisScores';
const MAX_RESULTS = 20;

let db = null;
let fs = null; // holds the imported firestore functions namespace
let initPromise = null;
let unsubscribeLive = null;

function isConfigured() {
  return FIREBASE_CONFIG.apiKey && !FIREBASE_CONFIG.apiKey.startsWith('YOUR_');
}

export function isOnlineLeaderboardConfigured() {
  return isConfigured();
}

async function init() {
  if (!isConfigured()) return null;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const [{ initializeApp }, firestoreMod] = await Promise.all([
        import('https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js')
      ]);
      const app = initializeApp(FIREBASE_CONFIG);
      fs = firestoreMod;
      db = fs.getFirestore(app);
      return db;
    } catch (err) {
      console.warn('Leaderboard: Firebase failed to load, using local scores only.', err);
      db = null;
      return null;
    }
  })();
  return initPromise;
}

// Fire-and-forget submit — never blocks or breaks gameplay if it fails.
export async function submitToLeaderboard(entry) {
  if (!isConfigured()) return false;
  try {
    await init();
    if (!db) return false;
    await fs.addDoc(fs.collection(db, COLLECTION), {
      name: String(entry.name || 'PLAYER').toUpperCase().slice(0, 12),
      score: Math.max(0, Math.min(9999999, Math.round(entry.score || 0))),
      lines: Math.max(0, Math.round(entry.lines || 0)),
      difficulty: entry.difficulty || 'moderate',
      mode: entry.mode || 'solo',
      ts: fs.serverTimestamp()
    });
    return true;
  } catch (err) {
    console.warn('Leaderboard: submit failed, score kept locally only.', err);
    return false;
  }
}

// One-time fetch of the top scores, optionally filtered by difficulty.
export async function fetchLeaderboard(filter) {
  if (!isConfigured()) return null; // null = "not available", vs [] = "available, empty"
  try {
    await init();
    if (!db) return null;
    const clauses = [fs.orderBy('score', 'desc'), fs.limit(MAX_RESULTS)];
    if (filter) clauses.unshift(fs.where('difficulty', '==', filter));
    const snap = await fs.getDocs(fs.query(fs.collection(db, COLLECTION), ...clauses));
    return snap.docs.map((d) => d.data());
  } catch (err) {
    console.warn('Leaderboard: fetch failed, falling back to local scores.', err);
    return null;
  }
}

// Live-updating subscription (keeps the High Scores screen fresh while
// other players are submitting). Call the returned function to unsubscribe.
export async function subscribeLeaderboard(filter, onUpdate) {
  if (!isConfigured()) return () => {};
  await init();
  if (!db) return () => {};
  if (unsubscribeLive) { unsubscribeLive(); unsubscribeLive = null; }
  const clauses = [fs.orderBy('score', 'desc'), fs.limit(MAX_RESULTS)];
  if (filter) clauses.unshift(fs.where('difficulty', '==', filter));
  const q = fs.query(fs.collection(db, COLLECTION), ...clauses);
  unsubscribeLive = fs.onSnapshot(q, (snap) => {
    onUpdate(snap.docs.map((d) => d.data()));
  }, (err) => {
    console.warn('Leaderboard: live updates failed.', err);
  });
  return unsubscribeLive;
}

export function stopLiveLeaderboard() {
  if (unsubscribeLive) { unsubscribeLive(); unsubscribeLive = null; }
}
