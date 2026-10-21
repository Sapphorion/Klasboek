// Settings: Microsoft account and syncing between devices.
import { h, icon, toast, confirmBox } from '../ui.js';
import { clientId, setClientId, redirectUri, signIn, signOut, signedIn, account } from '../msauth.js';
import { syncNow, syncInfo, onSync, autoSync, setAutoSync, resetSyncState } from '../sync.js';
import { ghConnect, ghConnected, ghInfo, ghDisconnect } from '../github.js';
import { fbConfigured, fbUser, onAuth, setLocalConfig, firebaseConfig } from '../fbauth.js';
import { signInFlow, signOutFlow } from '../signin.js';
import { inSkoolHuis, embeddedUser } from '../embed.js';

export function accountSection() {
  const sec = h('section', { class: 'card-sec account-sec' });
  if (inSkoolHuis) {
    // Opened from Skool Huis: the Skool Huis sign-in is the account. No Google, Microsoft or GitHub here.
    sec.append(h('h2', {}, 'Your account'),
      h('p', {}, 'You’re signed in with your Skool Huis account', embeddedUser?.email ? h('span', {}, ' (', h('strong', {}, embeddedUser.email), ')') : null, '. Your planner is kept in this browser, separate for each staff member, so colleagues on this computer don’t see it.'),
      h('p', { class: 'muted small' }, 'Download a backup under Backup below now and then, and before clearing the browser. Restore it to carry on at another computer.'));
    return sec;
  }
  const draw = () => {
    const s = syncInfo();
    const kids = [h('h2', {}, 'Your account')];
    const u = fbUser();
    if (u) {
      kids.push(
        h('div', { class: 'acct-row' }, h('span', { class: 'acct-dot g', 'aria-hidden': 'true' }, (u.name || u.email || '?').slice(0, 1).toUpperCase()),
          h('div', {}, h('strong', {}, u.name || u.email), h('div', { class: 'muted small' }, `${u.email} · Google`))),
        h('p', { class: 'small' }, 'Your work is saved to your account and is the same on every device where you sign in with this Google account.'),
        status(s), autoBox(),
        h('div', { class: 'row wrap' }, syncBtn(), h('button', { class: 'btn ghost', onclick: () => signOutFlow().then(draw) }, 'Sign out')));
      sec.replaceChildren(...kids);
      return;
    }
    const other = ghConnected() || signedIn();
    {
      kids.push(
        other ? h('p', { class: 'small' }, 'You can also sign in with Google instead: your work is then saved to your Google account (and stops syncing through GitHub on this device).')
          : h('p', {}, 'Sign in so your work is saved to your account and is there on your PC, phone and tablet. Without signing in, Klasboek keeps everything on this device only.'),
        h('div', { class: 'row wrap' }, h('button', { class: 'btn g-btn', disabled: !fbConfigured() || !navigator.onLine, onclick: async e => { const b = e.currentTarget; b.disabled = true; try { await signInFlow(); } catch (err) { toast(err.message, 'error'); } finally { b.disabled = false; draw(); } } }, gLogo(), 'Sign in with Google')),
        fbConfigured() ? null : h('p', { class: 'muted small' }, 'Google sign-in still needs to be switched on for this copy of Klasboek (once, by whoever looks after it).'),
        fbSetup(!fbConfigured()));
      if (other) kids.push(h('h3', { class: 'acct-sub' }, 'Syncing now'));
    }
    if (ghConnected()) {
      const g = ghInfo();
      kids.push(
        h('div', { class: 'acct-row' }, h('span', { class: 'acct-dot gh', 'aria-hidden': 'true' }, ghLogo()),
          h('div', {}, h('strong', {}, `GitHub · ${g.owner}/${g.repo}`), h('div', { class: 'muted small' }, `Signed in as ${g.login}. Private repository.`))),
        status(s), autoBox(),
        h('div', { class: 'row wrap' }, syncBtn(),
          h('a', { class: 'btn ghost', href: `https://github.com/${g.owner}/${g.repo}/commits`, target: '_blank', rel: 'noopener' }, 'Earlier versions'),
          h('button', { class: 'btn ghost', onclick: async () => {
            if (!await confirmBox('Disconnect GitHub on this device? Your work stays on this device and in the repository.', 'Disconnect')) return;
            ghDisconnect(); resetSyncState(); draw(); window.dispatchEvent(new Event('klasboek-sync')); toast('Disconnected.');
          } }, 'Disconnect')),
        h('p', { class: 'muted small' }, 'On your other devices: Settings › Sync between devices › paste the same token and repository name. Every sync is saved in the repository’s history, so you can get an earlier version back. Your Claude API key and the token are never synced.'));
    } else if (signedIn()) {
      const a = account();
      kids.push(
        h('div', { class: 'acct-row' }, h('span', { class: 'acct-dot', 'aria-hidden': 'true' }, (a.name || a.email || '?').slice(0, 1).toUpperCase()),
          h('div', {}, h('strong', {}, a.name || a.email), h('div', { class: 'muted small' }, `${a.email} · OneDrive`))),
        status(s), autoBox(),
        h('div', { class: 'row wrap' },
          s.needsSignIn ? h('button', { class: 'btn primary', onclick: () => signIn({ hint: a.email }).catch(e => toast(e.message, 'error')) }, 'Sign in again') : null,
          syncBtn(),
          h('button', { class: 'btn ghost', onclick: async () => {
            if (!await confirmBox('Sign out of Microsoft on this device? Your work stays on this device and in OneDrive.', 'Sign out')) return;
            signOut(); resetSyncState(); draw(); window.dispatchEvent(new Event('klasboek-sync')); toast('Signed out.');
          } }, 'Sign out')));
    } else {
      kids.push(h('details', { class: 'ext-steps' }, h('summary', {}, 'Other ways to sync: GitHub or a school Microsoft account'),
        h('p', {}, 'Your lessons, calendar, diary and files go into a private GitHub repository that only you can see, and every device you connect stays in step.'),
        githubSetup(draw),
        h('details', { class: 'ext-steps' }, h('summary', {}, 'Use a school Microsoft account instead'), msPart())));
    }
    sec.replaceChildren(...kids);
  };
  onSync(draw); onAuth(draw);
  window.addEventListener('klasboek-sync', draw);
  draw();
  return sec;
}

const status = s => h('p', { class: 'small ' + (s.error || s.needsSignIn ? 'warn' : 'muted') },
  s.needsSignIn ? 'Your sign-in has expired. Sign in again to keep syncing.' : s.error ? 'Last sync didn’t work: ' + s.error
    : s.syncing ? 'Syncing…' : s.lastSync ? `Last synced ${new Date(s.lastSync).toLocaleString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.${s.dirty ? ' Some changes still to upload.' : ''}` : 'Not synced yet.');
const autoBox = () => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: autoSync(), onchange: e => { setAutoSync(e.target.checked); if (e.target.checked) syncNow(); } }), 'Sync automatically');
const syncBtn = () => h('button', { class: 'btn', disabled: !navigator.onLine, onclick: async e => {
  const b = e.currentTarget; b.disabled = true;
  try { const r = await syncNow({ quiet: false }); toast({ pushed: 'Uploaded.', pulled: 'Updated from your other device.', same: 'Everything is up to date.', later: 'Left as it is for now.', skipped: 'You’re offline.' }[r] || 'Done.'); }
  catch (err) { toast(err.message, 'error'); } finally { b.disabled = false; }
} }, icon('swap'), 'Sync now');

function githubSetup(draw) {
  const token = h('input', { type: 'password', placeholder: 'github_pat_…', autocomplete: 'off', 'aria-label': 'GitHub access token' });
  const repo = h('input', { value: 'klasboek-data', 'aria-label': 'Repository name' });
  const out = h('div', { 'aria-live': 'polite' });
  const connect = h('button', { class: 'btn primary', onclick: async () => {
    connect.disabled = true; out.replaceChildren(h('span', { class: 'spinner' }), ' Checking with GitHub…');
    try {
      const r = await ghConnect(token.value, repo.value);
      resetSyncState();
      out.replaceChildren();
      toast(`Connected to ${r.owner}/${r.repo}. Syncing…`);
      window.dispatchEvent(new Event('klasboek-connected'));
      window.dispatchEvent(new Event('klasboek-sync'));
      draw();
    } catch (e) { out.replaceChildren(h('p', { class: 'error small' }, e.message)); }
    finally { connect.disabled = false; }
  } }, ghLogo(), 'Connect');
  return h('div', { class: 'stack' },
    h('details', { class: 'ext-steps', open: true }, h('summary', {}, 'Set it up (about 3 minutes, once)'),
      h('ol', {},
        h('li', {}, h('strong', {}, 'Make a private repository. '), 'Open ', h('a', { href: 'https://github.com/new?name=klasboek-data&visibility=private&description=My+Klasboek+data', target: '_blank', rel: 'noopener' }, 'github.com/new'),
          ', name it ', h('code', {}, 'klasboek-data'), ', choose ', h('strong', {}, 'Private'), ', then Create repository.'),
        h('li', {}, h('strong', {}, 'Make an access token. '), 'Open ', h('a', { href: 'https://github.com/settings/personal-access-tokens/new?name=Klasboek&description=Klasboek+sync&expires_in=none&contents=write', target: '_blank', rel: 'noopener' }, 'github.com › Settings › Fine-grained tokens › Generate new token'), '.',
          h('ul', {},
            h('li', {}, 'Token name: Klasboek. Expiration: the longest it allows (or No expiration).'),
            h('li', {}, 'Repository access: ', h('strong', {}, 'Only select repositories'), ' › klasboek-data.'),
            h('li', {}, 'Permissions › Repository permissions › ', h('strong', {}, 'Contents: Read and write'), '.'),
            h('li', {}, 'Generate token, then copy it (it starts with github_pat_). Keep a copy somewhere safe, like your password manager: you’ll paste the same token on each device.'))),
        h('li', {}, h('strong', {}, 'Paste it here and connect.')))),
    h('div', { class: 'form-grid' },
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Access token'), token),
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Repository'), repo)),
    h('div', { class: 'row wrap' }, connect),
    out,
    h('p', { class: 'muted small' }, 'The token can only open that one repository. Anyone who has it can read your Klasboek data, so don’t share it. It stays on this device and is never synced.'));
}

function msPart() {
  if (!clientId()) return h('div', { class: 'stack' }, h('p', { class: 'small' }, 'For a school or work Microsoft 365 account, Klasboek needs to be registered in your school’s Microsoft Entra first (usually by IT).'), setupDetails(false));
  return h('div', { class: 'stack' },
    h('button', { class: 'btn ms-btn', disabled: !navigator.onLine, onclick: () => signIn().catch(e => toast(e.message, 'error')) }, msLogo(), 'Sign in with Microsoft'),
    setupDetails(false));
}

const ghLogo = () => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('width', '18'); s.setAttribute('height', '18'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('fill', 'currentColor');
  s.innerHTML = '<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>'; return s; };

function setupDetails(open) {
  const input = h('input', { placeholder: 'e.g. 1a2b3c4d-1234-5678-9abc-def012345678', value: clientId(), 'aria-label': 'Application (client) ID' });
  const uri = redirectUri();
  return h('details', { class: 'ext-steps', open },
    h('summary', {}, open ? 'Set it up (one time)' : 'Change the app registration'),
    h('ol', {},
      h('li', {}, 'On a computer, go to ', h('a', { href: 'https://entra.microsoft.com', target: '_blank', rel: 'noopener' }, 'entra.microsoft.com'), ' and sign in. A school or work account usually works straight away. With a personal account (Outlook/Hotmail) you first need a free Azure account (', h('a', { href: 'https://azure.microsoft.com/free', target: '_blank', rel: 'noopener' }, 'azure.microsoft.com/free'), '), which gives you the directory to register apps in.'),
      h('li', {}, 'Go to Applications › App registrations › New registration.'),
      h('li', {}, 'Name: Klasboek. Supported account types: “Accounts in any organizational directory and personal Microsoft accounts”.'),
      h('li', {}, 'Redirect URI: choose “Single-page application (SPA)” and paste exactly: ', h('code', { class: 'copyable', onclick: () => navigator.clipboard?.writeText(uri).then(() => toast('Copied.')) }, uri)),
      h('li', {}, 'Click Register. Copy the “Application (client) ID” and paste it here:')),
    h('div', { class: 'row wrap' }, input,
      h('button', { class: 'btn', onclick: () => {
        const v = input.value.trim();
        if (v && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) { toast('That doesn’t look like an Application (client) ID. It has 5 groups of letters and numbers.', 'error'); return; }
        setClientId(v); toast(v ? 'Saved. Now sign in.' : 'Removed.'); window.dispatchEvent(new Event('klasboek-sync'));
      } }, 'Save')),
    h('p', { class: 'muted small' }, 'The ID isn’t a secret. Send it to whoever looks after your Klasboek copy and it can be built in, so other devices don’t need this step. If a school account says it needs admin approval, ask your school’s IT admin, or use a personal account.'));
}

const msLogo = () => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 21 21'); s.setAttribute('width', '18'); s.setAttribute('height', '18'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = '<rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/><rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/>'; return s; };

const gLogo = () => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 48 48'); s.setAttribute('width', '18'); s.setAttribute('height', '18'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = '<path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.2l7.8 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.3 5.7c4.3-3.9 7-9.8 7-17.1z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.8l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.3-5.7c-2.1 1.4-4.9 2.3-8.6 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.8 6.1C6.6 42.6 14.6 48 24 48z"/>'; return s; };

// One-time setup of Google sign-in for this copy of Klasboek.
function fbSetup(open) {
  const ta = h('textarea', { rows: 6, placeholder: 'const firebaseConfig = {\n  apiKey: "…",\n  authDomain: "….firebaseapp.com",\n  projectId: "…",\n  appId: "…"\n};', 'aria-label': 'Firebase config' }, firebaseConfig() ? JSON.stringify(firebaseConfig(), null, 2) : '');
  const site = location.hostname || 'sapphorion.github.io';
  return h('details', { class: 'ext-steps', open },
    h('summary', {}, open ? 'Switch on Google sign-in (once, about 10 minutes)' : 'Google sign-in setup'),
    h('ol', {},
      h('li', {}, 'Go to ', h('a', { href: 'https://console.firebase.google.com', target: '_blank', rel: 'noopener' }, 'console.firebase.google.com'), ', sign in with Google and click ', h('strong', {}, 'Create a project'), '. Name it Klasboek. Google Analytics isn’t needed.'),
      h('li', {}, h('strong', {}, 'Build › Authentication › Get started › Google'), ': switch it on, choose your email as support email, Save.'),
      h('li', {}, 'Still in Authentication: ', h('strong', {}, 'Settings › Authorised domains › Add domain'), ': ', h('code', {}, site), '.'),
      h('li', {}, h('strong', {}, 'Build › Firestore Database › Create database'), '. Choose a location near you (for example africa-south1 or europe-west1) and start in ', h('strong', {}, 'production mode'), '.'),
      h('li', {}, 'In Firestore, open ', h('strong', {}, 'Rules'), ', replace everything with this and Publish:',
        h('pre', { class: 'code-box' }, "rules_version = '2';\nservice cloud.firestore {\n  match /databases/{database}/documents {\n    match /users/{uid}/{document=**} {\n      allow read, write: if request.auth != null && request.auth.uid == uid;\n    }\n  }\n}")),
      h('li', {}, 'Project settings (the gear) › ', h('strong', {}, 'Your apps › Web (</>)'), '. Name it Klasboek and register. Copy the ', h('code', {}, 'firebaseConfig'), ' it shows and paste it here:')),
    ta,
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn', onclick: () => { try { setLocalConfig(ta.value.trim()); toast(ta.value.trim() ? 'Saved on this device. Now sign in with Google.' : 'Removed.'); window.dispatchEvent(new Event('klasboek-sync')); } catch (e) { toast(e.message, 'error'); } } }, 'Save')),
    h('p', { class: 'muted small' }, 'These values aren’t secret; the rules above make sure each person can only open their own data. To switch sign-in on for everyone who uses this copy (so nobody needs this step), send the config to whoever maintains Klasboek to build in.'));
}
