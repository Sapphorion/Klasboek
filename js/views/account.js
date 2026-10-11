// Settings: Microsoft account and syncing between devices.
import { h, icon, toast, confirmBox } from '../ui.js';
import { clientId, setClientId, redirectUri, signIn, signOut, signedIn, account } from '../msauth.js';
import { syncNow, syncInfo, onSync, autoSync, setAutoSync } from '../sync.js';

export function accountSection() {
  const sec = h('section', { class: 'card-sec account-sec' });
  const draw = () => {
    const s = syncInfo();
    const kids = [h('h2', {}, 'Microsoft account and sync')];
    if (signedIn()) {
      const a = account();
      kids.push(
        h('div', { class: 'acct-row' }, h('span', { class: 'acct-dot', 'aria-hidden': 'true' }, (a.name || a.email || '?').slice(0, 1).toUpperCase()),
          h('div', {}, h('strong', {}, a.name || a.email), h('div', { class: 'muted small' }, a.email))),
        h('p', { class: 'small ' + (s.error || s.needsSignIn ? 'warn' : 'muted') },
          s.needsSignIn ? 'Your sign-in has expired. Sign in again to keep syncing.' : s.error ? 'Last sync didn’t work: ' + s.error
            : s.syncing ? 'Syncing…' : s.lastSync ? `Last synced ${new Date(s.lastSync).toLocaleString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.${s.dirty ? ' Some changes still to upload.' : ''}` : 'Not synced yet.'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: autoSync(), onchange: e => { setAutoSync(e.target.checked); if (e.target.checked) syncNow(); } }), 'Sync automatically'),
        h('div', { class: 'row wrap' },
          s.needsSignIn ? h('button', { class: 'btn primary', onclick: () => signIn({ hint: a.email }).catch(e => toast(e.message, 'error')) }, 'Sign in again') : null,
          h('button', { class: 'btn', disabled: !navigator.onLine, onclick: async e => {
            const b = e.currentTarget; b.disabled = true;
            try { const r = await syncNow({ quiet: false }); toast({ pushed: 'Uploaded to OneDrive.', pulled: 'Updated from OneDrive.', same: 'Everything is up to date.', later: 'Left as it is for now.', skipped: 'You’re offline.' }[r] || 'Done.'); }
            catch (err) { toast(err.message, 'error'); } finally { b.disabled = false; }
          } }, icon('swap'), 'Sync now'),
          h('button', { class: 'btn ghost', onclick: async () => {
            if (!await confirmBox('Sign out of Microsoft on this device? Your work stays on this device and in OneDrive.', 'Sign out')) return;
            signOut(); draw(); window.dispatchEvent(new Event('klasboek-sync')); toast('Signed out.');
          } }, 'Sign out')),
        h('p', { class: 'muted small' }, 'Sign in with the same account on your PC, phone and tablet and they stay the same. Your data is kept in your OneDrive under Apps › Klasboek. Your Claude API key is never synced.'));
    } else if (clientId()) {
      kids.push(
        h('p', {}, 'Sign in with your Microsoft account and use Klasboek on your PC, phone and tablet with the same lessons, calendar and diary.'),
        h('button', { class: 'btn primary ms-btn', disabled: !navigator.onLine, onclick: () => signIn().catch(e => toast(e.message, 'error')) }, msLogo(), 'Sign in with Microsoft'),
        h('p', { class: 'muted small' }, 'Works with a personal Microsoft account (Outlook, Hotmail, Live) or a work or school account. Your data goes to your own OneDrive, in a folder only Klasboek uses.'),
        setupDetails(false));
    } else {
      kids.push(
        h('p', {}, 'Sign in with your Microsoft account to keep your PC, phone and tablet the same. First, Klasboek needs to be registered with Microsoft once. It takes about 10 minutes on a computer.'),
        setupDetails(true));
    }
    sec.replaceChildren(...kids);
  };
  onSync(draw);
  window.addEventListener('klasboek-sync', draw);
  draw();
  return sec;
}

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
