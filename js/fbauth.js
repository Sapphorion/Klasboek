// Sign in with Google (Firebase) and keep your Klasboek in your account, so it's there on every
// device you sign in on. The Firebase code only loads when you use it, so Klasboek still opens offline.
import { FIREBASE_CONFIG } from './config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
const FLAG = 'klasboek.fb';        // "this device was signed in", so we restore the session at start-up
const LOCAL_CFG = 'klasboek.firebaseConfig';
const PART = 700000;               // characters per stored piece (Firestore allows about 1 MB per document)

export const firebaseConfig = () => {
  try { const c = JSON.parse(localStorage.getItem(LOCAL_CFG) || 'null'); if (c?.apiKey) return c; } catch {}
  return FIREBASE_CONFIG?.apiKey ? FIREBASE_CONFIG : null;
};
export const fbConfigured = () => !!firebaseConfig();
// Accepts the snippet Firebase shows ("const firebaseConfig = { apiKey: "…", … };") or plain JSON.
export function setLocalConfig(text) {
  if (!text) { localStorage.removeItem(LOCAL_CFG); return null; }
  const body = String(text).slice(String(text).indexOf('{'), String(text).lastIndexOf('}') + 1);
  const json = body.replace(/([{,]\s*)([A-Za-z_][\w]*)\s*:/g, '$1"$2":').replace(/'/g, '"').replace(/,\s*}/g, '}');
  const cfg = JSON.parse(json);
  if (!cfg.apiKey || !cfg.projectId) throw new Error('That doesn’t look like a Firebase config (it needs apiKey and projectId).');
  localStorage.setItem(LOCAL_CFG, JSON.stringify(cfg));
  return cfg;
}

let fb = null, user = null, readyP = null;
const listeners = new Set();
export const onAuth = fn => (listeners.add(fn), () => listeners.delete(fn));
const tell = () => listeners.forEach(f => f(user));
export const fbUser = () => user;
export const wasSignedIn = () => { try { return localStorage.getItem(FLAG) === '1'; } catch { return false; } };

async function loadSdk() {
  if (window.__kbFirebase) return window.__kbFirebase; // tests
  const [app, auth, fs] = await Promise.all(['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js'].map(f => import(SDK + f)));
  return { ...app, ...auth, ...fs };
}
// Start Firebase and wait until it knows whether someone is signed in.
export function initFirebase() {
  if (readyP) return readyP;
  const cfg = firebaseConfig();
  if (!cfg) return Promise.resolve(null);
  readyP = (async () => {
    const s = await loadSdk();
    const app = s.initializeApp(cfg);
    const auth = s.getAuth(app);
    const db = s.getFirestore(app);
    fb = { s, auth, db };
    try { await s.getRedirectResult?.(auth); } catch {}
    await new Promise(res => { let first = true; s.onAuthStateChanged(auth, u => { user = u ? { uid: u.uid, name: u.displayName || '', email: u.email || '', photo: u.photoURL || '' } : null; try { if (user) localStorage.setItem(FLAG, '1'); } catch {} tell(); if (first) { first = false; res(); } }); });
    return fb;
  })().catch(e => { readyP = null; throw new Error('Couldn’t start Google sign-in. Check your internet connection. (' + e.message + ')'); });
  return readyP;
}

export async function googleSignIn() {
  if (!fbConfigured()) throw new Error('Google sign-in isn’t set up for Klasboek yet.');
  if (!navigator.onLine) throw new Error('You need internet to sign in.');
  const { s, auth } = await initFirebase();
  const provider = new s.GoogleAuthProvider();
  provider.setCustomParameters?.({ prompt: 'select_account' });
  try { await s.signInWithPopup(auth, provider); }
  catch (e) {
    if (/popup-blocked|popup_blocked|operation-not-supported/.test(e.code || e.message)) { await s.signInWithRedirect(auth, provider); return null; }
    if (/popup-closed|cancelled-popup/.test(e.code || e.message)) return null;
    if (/unauthorized-domain/.test(e.code || '')) throw new Error('This web address isn’t allowed to sign in yet. In Firebase, add it under Authentication › Settings › Authorised domains.');
    throw new Error('Sign-in didn’t work: ' + (e.message || e.code));
  }
  try { localStorage.setItem(FLAG, '1'); } catch {}
  return user;
}
export async function googleSignOut() {
  try { localStorage.removeItem(FLAG); } catch {}
  if (fb) await fb.s.signOut(fb.auth);
  user = null; tell();
}

// ---------- Your data in Firestore: users/{uid} holds the version, users/{uid}/parts/{n} the pieces ----------
const meta = () => fb.s.doc(fb.db, 'users', user.uid);
const part = n => fb.s.doc(fb.db, 'users', user.uid, 'parts', String(n));
const denied = e => /permission|insufficient/i.test(e.code || e.message) ? new Error('Your account’s storage refused the save. Check the Firestore rules (see the setup steps).') : e;
export const fbProvider = {
  name: 'your Google account',
  ready: () => !!(user && fb),
  async version() { try { const d = await fb.s.getDoc(meta()); return d.exists() ? d.data().version || null : null; } catch (e) { throw denied(e); } },
  async download() {
    const d = await fb.s.getDoc(meta()); const n = d.data().parts || 0;
    const bits = [];
    for (let i = 0; i < n; i++) { const p = await fb.s.getDoc(part(i)); if (!p.exists()) throw new Error('Part of your saved data is missing. Try again in a minute.'); bits.push(p.data().d); }
    return new Blob([bits.join('')], { type: 'application/json' });
  },
  async upload(blob, prev) {
    try {
      const cur = await fb.s.getDoc(meta());
      if (prev && cur.exists() && cur.data().version !== prev) throw new Error('conflict');
      const text = await blob.text();
      const n = Math.max(1, Math.ceil(text.length / PART));
      for (let i = 0; i < n; i++) await fb.s.setDoc(part(i), { d: text.slice(i * PART, (i + 1) * PART) });
      const old = cur.exists() ? cur.data().parts || 0 : 0;
      const version = new Date().toISOString() + '-' + Math.random().toString(36).slice(2, 6);
      await fb.s.setDoc(meta(), { version, parts: n, size: text.length, saved: new Date().toISOString(), app: 'klasboek' });
      for (let i = n; i < old; i++) await fb.s.deleteDoc(part(i));
      return version;
    } catch (e) { throw e.message === 'conflict' ? e : denied(e); }
  },
};
