const $ = id => document.getElementById(id);
const status = $('organizer-status');
const signIn = $('organizer-sign-in');
const signOutButton = $('organizer-sign-out');
const identity = $('organizer-identity');
const uid = $('organizer-uid');
const copyStatus = $('organizer-copy-status');

function authMessage(error) {
  const messages = {
    'auth/popup-blocked': 'Allow popups for this site, then select Sign in with Google again.',
    'auth/popup-closed-by-user': 'Sign-in was canceled. Select Sign in with Google to try again.',
    'auth/cancelled-popup-request': 'Another sign-in attempt is already open.',
    'auth/unauthorized-domain': 'This domain is not authorized. Open Firebase Authentication → Settings → Authorized domains and add this site’s hostname.',
    'auth/operation-not-allowed': 'Enable Google in Firebase Authentication → Sign-in method, then try again.',
    'auth/network-request-failed': 'Sign-in could not connect. Check your connection and try again.',
    'auth/account-exists-with-different-credential': 'This email already uses another sign-in method. Use that method before linking Google.'
  };
  return messages[error?.code] || 'Sign-in is unavailable. Check the Firebase web configuration and Authentication settings, then reload.';
}

async function start() {
  try {
    const [{ initializeApp, getApps, getApp }, authSdk, { firebaseConfig }] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js'),
      import('./firebase-config.js')
    ]);
    const { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
      setPersistence, browserSessionPersistence } = authSdk;
    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    const auth = getAuth(app);
    await setPersistence(auth, browserSessionPersistence);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    onAuthStateChanged(auth, user => {
      const googleUser = user && !user.isAnonymous &&
        user.providerData.some(item => item.providerId === 'google.com');
      signIn.hidden = Boolean(googleUser);
      signOutButton.hidden = !user;
      identity.hidden = !googleUser;
      uid.value = googleUser ? user.uid : '';
      $('organizer-account').textContent = googleUser ? (user.email || user.displayName || 'Google account') : '';
      copyStatus.textContent = '';
      status.textContent = googleUser
        ? 'Signed in. Copy your user ID so we can finish setting up TO access.'
        : 'Sign in with your organizer Google account.';
      signIn.disabled = false;
    }, error => {
      status.textContent = authMessage(error);
    });

    signIn.addEventListener('click', async () => {
      signIn.disabled = true;
      status.textContent = 'Complete sign-in in the Google popup.';
      try {
        await signInWithPopup(auth, provider);
      } catch (error) {
        status.textContent = authMessage(error);
      } finally {
        signIn.disabled = false;
      }
    });
    signOutButton.addEventListener('click', async () => {
      signOutButton.disabled = true;
      try {
        await signOut(auth);
      } catch (error) {
        status.textContent = authMessage(error);
      } finally {
        signOutButton.disabled = false;
      }
    });
  } catch (error) {
    status.textContent = authMessage(error);
  }
}

$('organizer-copy').addEventListener('click', async () => {
  if (!uid.value) return;
  try {
    await navigator.clipboard.writeText(uid.value);
    copyStatus.textContent = 'User ID copied.';
  } catch {
    uid.focus();
    uid.select();
    copyStatus.textContent = 'Copy the selected user ID manually.';
  }
});
start();
