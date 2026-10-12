// Sync through a private GitHub repository, using a fine-grained access token that can only
// read and write that one repository. No app registration needed.
// The token stays on this device (localStorage); it is never put in backups or in the repository.
const LS = 'klasboek.gh';
const API = 'https://api.github.com';
const MAIN = 'klasboek-sync.json';

const read = () => { try { return JSON.parse(localStorage.getItem(LS) || 'null'); } catch { return null; } };
const write = v => { if (v) localStorage.setItem(LS, JSON.stringify(v)); else localStorage.removeItem(LS); };
export const ghInfo = () => { const v = read(); return v ? { login: v.login, owner: v.owner, repo: v.repo } : null; };
export const ghConnected = () => !!read()?.token;
export const ghDisconnect = () => write(null);

async function api(path, { method = 'GET', body, accept = 'application/vnd.github+json', token = read()?.token } = {}) {
  const res = await fetch(API + path, { method, cache: 'no-store', body: body ? JSON.stringify(body) : undefined,
    headers: { Authorization: 'Bearer ' + token, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) } });
  if (res.status === 404 && method === 'GET') return null;
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    const e = new Error(res.status === 401 ? 'GitHub didn’t accept the token. It may have expired: make a new one and connect again.'
      : res.status === 403 ? 'The token isn’t allowed to do that. Check it has “Contents: Read and write” for the repository.'
      : res.status === 409 || (res.status === 422 && /sha/i.test(j.message || '')) ? 'conflict' : j.message || `GitHub said ${res.status}`);
    e.status = res.status; throw e;
  }
  return accept.includes('raw') ? res.text() : res.json();
}

// Check the token and repository, then remember them.
export async function ghConnect(token, repoName) {
  token = token.trim(); repoName = repoName.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
  if (!token) throw new Error('Paste the token first.');
  const me = await api('/user', { token }).catch(e => { throw e.status === 401 ? new Error('GitHub didn’t accept that token. Copy it again (it starts with github_pat_).') : e; });
  if (!me) throw new Error('GitHub didn’t accept that token.');
  const [owner, repo] = repoName.includes('/') ? repoName.split('/') : [me.login, repoName || 'klasboek-data'];
  const r = await api(`/repos/${owner}/${repo}`, { token });
  if (!r) throw new Error(`Couldn’t find the repository ${owner}/${repo}, or the token can’t see it. Check the name, and that the token has access to it.`);
  if (!r.private) throw new Error(`${owner}/${repo} is public, so anyone could read your data. Make it private on GitHub (Settings › Danger zone › Change visibility) and connect again.`);
  if (r.permissions && !r.permissions.push) throw new Error('The token can read but not write. Give it “Contents: Read and write”.');
  write({ token, owner, repo, login: me.login });
  return { owner, repo, login: me.login };
}

const path = p => { const v = read(); return `/repos/${v.owner}/${v.repo}/contents/${p}`; };

// base64 of a (possibly large) UTF-8 string, without blowing the stack.
function b64(str) {
  const bytes = new TextEncoder().encode(str);
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

export const gh = {
  name: 'GitHub',
  ready: ghConnected,
  // Current version of the shared copy (its sha), or null if there isn't one yet.
  async version() { const m = await api(path(MAIN)); return m ? m.sha : null; },
  // Backup JSON text, with attached files fetched back in.
  async download() {
    const json = JSON.parse(await api(path(MAIN), { accept: 'application/vnd.github.raw+json' }));
    for (const r of json.data.materials || []) {
      if (!r._ghFile) continue;
      const txt = await api(path('files/' + r._ghFile), { accept: 'application/vnd.github.raw+json' });
      if (txt) { r.blob = txt; r._b64 = true; } else r.blob = null;
      delete r._ghFile;
    }
    return new Blob([JSON.stringify(json)], { type: 'application/json' });
  },
  // Upload a backup (Blob). Files go up once each, separately, so every sync stays small.
  async upload(blob, prev) {
    const json = JSON.parse(await blob.text());
    const have = new Set(read().files || []);
    for (const r of json.data.materials || []) {
      if (!r._b64 || typeof r.blob !== 'string') continue;
      if (!have.has(r.id)) {
        const exists = await api(path('files/' + r.id));
        if (!exists) await api(path('files/' + r.id), { method: 'PUT', body: { message: `Klasboek file ${r.name || r.id}`, content: b64(r.blob) } });
        have.add(r.id);
      }
      r._ghFile = r.id; r.blob = null; delete r._b64;
    }
    write({ ...read(), files: [...have] });
    const text = JSON.stringify(json);
    if (text.length > 90 * 1024 * 1024) throw new Error('Your data is too big for GitHub sync (over 90 MB).');
    const res = await api(path(MAIN), { method: 'PUT', body: { message: `Klasboek sync ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, content: b64(text), ...(prev ? { sha: prev } : {}) } });
    return res.content.sha;
  },
};
