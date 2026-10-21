// Klasboek inside Skool Huis. When Klasboek is opened from the school's Skool Huis site
// (skoolhuis.netlify.app/klasboek/), it is the teacher's own Klasboek with their Skool Huis
// sign-in: no second login, and it is linked to the school straight away.
//
// Several teachers may use the same staffroom computer, so each teacher's Klasboek data
// (the database and everything Klasboek keeps in localStorage) is kept apart by their
// Skool Huis account. Nobody sees another teacher's planner.
//
// This module must load before anything else touches storage (it is the first import in app.js).

import { SKOOLHUIS } from './config.js';

const P = typeof Storage !== 'undefined' ? Storage.prototype : null;
const origGet = P?.getItem, origSet = P?.setItem, origRemove = P?.removeItem;
const ls = (() => { try { return window.localStorage; } catch { return null; } })();

/** Storage without the per-teacher prefix (for the Skool Huis sign-in itself). */
export const rawStorage = {
  get: k => { try { return ls ? origGet.call(ls, k) : null; } catch { return null; } },
  set: (k, v) => { try { ls && origSet.call(ls, k, v); } catch {} },
};

const ref = (() => { try { return new URL(SKOOLHUIS.url).hostname.split('.')[0]; } catch { return ''; } })();
/** Where the Skool Huis app keeps its sign-in in this browser. */
export const SB_KEY = `sb-${ref}-auth-token`;

export const inSkoolHuis = (() => { try { return location.origin === new URL(SKOOLHUIS.app).origin; } catch { return false; } })();

export function skoolHuisSession() {
  try { return JSON.parse(rawStorage.get(SB_KEY) || 'null'); } catch { return null; }
}

const startUser = inSkoolHuis ? skoolHuisSession()?.user || null : null;
/** The Skool Huis teacher this Klasboek belongs to (null outside Skool Huis). */
export const embeddedUser = startUser ? { id: startUser.id, email: startUser.email } : null;
/** Added to the database name so each teacher has their own. */
export const storageSuffix = embeddedUser ? `-${embeddedUser.id}` : '';

if (inSkoolHuis && !embeddedUser) {
  // Not signed in to Skool Huis in this browser: sign in there first.
  location.replace(`${SKOOLHUIS.app}/`);
}

if (embeddedUser && ls && P) {
  const prefix = `klasboek:${embeddedUser.id}:`;
  const own = k => (typeof k === 'string' && k !== SB_KEY ? prefix + k : k);
  P.getItem = function (k) { return this === ls ? origGet.call(this, own(k)) : origGet.call(this, k); };
  P.setItem = function (k, v) { return this === ls ? origSet.call(this, own(k), v) : origSet.call(this, k, v); };
  P.removeItem = function (k) { return this === ls ? origRemove.call(this, own(k)) : origRemove.call(this, k); };
}

/** Back to Skool Huis (same tab). */
export const skoolHuisHome = () => `${SKOOLHUIS.app}/#/`;
