// Fill in once Klasboek is registered with Microsoft (Application (client) ID), so every device
// can sign in without typing it. It isn't secret. It can also be typed in Settings on each device.
export const MS_CLIENT_ID = '';

// Google sign-in (Firebase). Paste the firebaseConfig from the Firebase console here
// (Project settings › Your apps › Web app). These values aren't secret: your data is protected
// by the Firestore rules, which only let each person read and write their own data.
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyD4ENZIDrZ2rJw9KkD7qRjHbe4oelqT3DU',
  authDomain: 'klasboek-1f2cd.firebaseapp.com',
  projectId: 'klasboek-1f2cd',
  storageBucket: 'klasboek-1f2cd.firebasestorage.app',
  messagingSenderId: '159262207752',
  appId: '1:159262207752:web:0702978928b7f8332946bd',
};

// Skool Huis, the school's own system (learners, calendar, mark book, inventory).
// Public values: the publishable key only allows what the school database's
// security rules allow, and every teacher signs in with their own account.
export const SKOOLHUIS = {
  url: 'https://eccijbibnfgmsdyfqfxp.supabase.co',
  key: 'sb_publishable_JYBGp69pc7QjcDYZ05J3Dg_rWk4jj7C',
  app: 'https://skoolhuis.netlify.app',
};
