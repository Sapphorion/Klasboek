// Sign in with a Microsoft account (personal, or work/school) straight from the browser.
// OAuth 2.0 authorization code flow with PKCE, as a single-page app: no server, no secret.
// Tokens stay on this device (localStorage) and never go into backups or the OneDrive copy.
import { MS_CLIENT_ID } from './config.js';

const AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0';
export const SCOPES = 'openid profile offline_access User.Read Files.ReadWrite.AppFolder';
const LS = 'klasboek.ms';
const LS_CLIENT = 'klasboek.ms.client';

export const redirectUri = () => location.origin + location.pathname;
export const clientId = () => localStorage.getItem(LS_CLIENT) || MS_CLIENT_ID || '';
export function setClientId(id) { id = (id || '').trim(); if (id) localStorage.setItem(LS_CLIENT, id); else localStorage.removeItem(LS_CLIENT); }

const read = () => { try { return JSON.parse(localStorage.getItem(LS) || 'null'); } catch { return null; } };
const write = v => { if (v) localStorage.setItem(LS, JSON.stringify(v)); else localStorage.removeItem(LS); };
export const account = () => read()?.account || null;
export const signedIn = () => !!read()?.account;

const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomString = n => b64url(crypto.getRandomValues(new Uint8Array(n)));

export async function signIn({ silent = false, hint = '' } = {}) {
  const cid = clientId();
  if (!cid) throw new Error('Add the Application (client) ID first.');
  const verifier = randomString(48);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = randomString(16);
  sessionStorage.setItem('ms.pkce', JSON.stringify({ verifier, state, back: location.hash || '#settings', silent }));
  const q = new URLSearchParams({ client_id: cid, response_type: 'code', redirect_uri: redirectUri(), response_mode: 'query', scope: SCOPES,
    code_challenge: challenge, code_challenge_method: 'S256', state });
  if (silent) q.set('prompt', 'none'); else q.set('prompt', 'select_account');
  if (hint) q.set('login_hint', hint);
  location.assign(`${AUTH}/authorize?${q}`);
}

async function tokenRequest(body) {
  const res = await fetch(`${AUTH}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId(), scope: SCOPES, ...body }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(j.error_description?.split('\n')[0] || j.error || `Sign-in failed (${res.status})`); e.code = j.error; throw e; }
  return j;
}
function store(j, prev = read()) {
  const now = Date.now();
  const v = { ...(prev || {}), access: j.access_token, accessExp: now + (j.expires_in - 120) * 1000 };
  if (j.refresh_token) { v.refresh = j.refresh_token; v.refreshExp = now + 23 * 3600 * 1000; } // browser-app refresh tokens last 24 hours
  write(v); return v;
}

// Call once at start-up: finishes a sign-in that just came back from Microsoft. Returns true if it handled one.
export async function handleRedirect() {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return false;
  const saved = JSON.parse(sessionStorage.getItem('ms.pkce') || 'null');
  sessionStorage.removeItem('ms.pkce');
  history.replaceState(null, '', redirectUri() + (saved?.back || '#settings'));
  if (q.has('error')) {
    if (saved?.silent) { const v = read(); if (v) write({ ...v, needsSignIn: true }); return 'silent-failed'; }
    throw new Error(q.get('error_description')?.split('\n')[0] || q.get('error'));
  }
  if (!saved || saved.state !== q.get('state')) throw new Error('The sign-in didn’t match. Please try again.');
  const j = await tokenRequest({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: redirectUri(), code_verifier: saved.verifier });
  const v = store(j, { ...(read() || {}), needsSignIn: false });
  const me = await (await fetch('https://graph.microsoft.com/v1.0/me', { headers: { Authorization: 'Bearer ' + v.access } })).json();
  write({ ...v, account: { name: me.displayName || '', email: me.mail || me.userPrincipalName || '', id: me.id } });
  return 'signed-in';
}

export class NeedSignIn extends Error {}
export async function getToken() {
  const v = read();
  if (!v?.account) throw new NeedSignIn('Not signed in.');
  if (v.access && v.accessExp > Date.now()) return v.access;
  if (v.refresh && v.refreshExp > Date.now()) {
    try { return store(await tokenRequest({ grant_type: 'refresh_token', refresh_token: v.refresh })).access; }
    catch (e) { if (!navigator.onLine) throw e; }
  }
  write({ ...v, access: '', refresh: '', needsSignIn: true });
  throw new NeedSignIn('Your Microsoft sign-in has expired.');
}
export const needsSignIn = () => !!read()?.needsSignIn;

// Browser-app sign-ins only last a day. When it has run out, quietly ask Microsoft again (one quick bounce,
// no password if you're still signed in there). Only tried once per visit.
export async function renewIfNeeded() {
  const v = read();
  if (!v?.account || !navigator.onLine || sessionStorage.getItem('ms.silentTried')) return false;
  if (v.access && v.accessExp > Date.now()) return false;
  if (v.refresh && v.refreshExp > Date.now()) return false;
  sessionStorage.setItem('ms.silentTried', '1');
  await signIn({ silent: true, hint: v.account.email });
  return true;
}

export function signOut() { write(null); }

export async function graph(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const token = await getToken();
  const res = await fetch(path.startsWith('http') ? path : 'https://graph.microsoft.com/v1.0' + path, { method, body, headers: { Authorization: 'Bearer ' + token, ...headers } });
  if (raw) return res;
  if (res.status === 404) return null;
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error?.message || `Microsoft said ${res.status}`); }
  return res.status === 204 ? null : res.json();
}
