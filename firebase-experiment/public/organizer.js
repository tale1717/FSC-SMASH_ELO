import { createOverview } from './organizer-overview.js';
import { createEditor } from './organizer-editor.js';
import { createLiveDashboard } from './organizer-matches.js';
const $ = id => document.getElementById(id);
const status = $('organizer-status');
const login = $('organizer-login');
const googleButton = $('organizer-sign-in');
const passwordButton = $('organizer-password-login');
const logout = $('organizer-sign-out');
const identity = $('organizer-identity');
const uid = $('organizer-uid');
const copyStatus = $('organizer-copy-status');
const api = 'https://fsc-smash-elo-api.dstalero71.workers.dev';
let revision = 0;

function message(error) {
  const messages = {
    'auth/popup-blocked': 'Allow popups for this site and try again.',
    'auth/popup-closed-by-user': 'Sign-in was canceled.',
    'auth/unauthorized-domain': 'This hostname must be added to Firebase Authentication authorized domains.',
    'auth/operation-not-allowed': 'This sign-in method is not enabled. Contact the owner.',
    'auth/network-request-failed': 'Check your connection and try again.',
    'auth/too-many-requests': 'Too many attempts. Please wait before trying again.'
  };
  return messages[error?.code] || 'Unable to sign in. Check your credentials or contact the owner.';
}
async function start() {
  try {
    const [{ initializeApp, getApps, getApp }, sdk, { firebaseConfig }] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js'),
      import('./firebase-config.js')
    ]);
    const auth = sdk.getAuth(getApps().length ? getApp() : initializeApp(firebaseConfig));
    const live = createLiveDashboard(auth, api);
    const editor = createEditor(auth,api);
    const overview = createOverview(auth,api);
    await sdk.setPersistence(auth, sdk.browserSessionPersistence);
    const provider = new sdk.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const busy = value => { googleButton.disabled = value; passwordButton.disabled = value; };
    async function attempt(action) {
      busy(true);
      status.textContent = 'Signing in…';
      try { await action(); }
      catch (error) { status.textContent = message(error); }
      finally { $('organizer-password').value = ''; busy(false); }
    }
    login.addEventListener('submit', event => {
      event.preventDefault();
      attempt(() => sdk.signInWithEmailAndPassword(auth, $('organizer-email').value.trim(), $('organizer-password').value));
    });
    googleButton.addEventListener('click', () => attempt(() => sdk.signInWithPopup(auth, provider)));
    logout.addEventListener('click', async () => {
      logout.disabled = true;
      try { await sdk.signOut(auth); }
      catch (error) { status.textContent = message(error); }
      finally { logout.disabled = false; }
    });
    sdk.onAuthStateChanged(auth, async user => {
      const current = ++revision;
      live.reset();
      editor.reset();
      overview.reset();
      identity.hidden = true;
      uid.value = '';
      copyStatus.textContent = '';
      $('organizer-account').textContent = '';
      login.hidden = Boolean(user);
      googleButton.hidden = Boolean(user);
      logout.hidden = !user;
      busy(false);
      if (!user) {
        status.textContent = 'Sign in using your approved organizer account.';
        return;
      }
      status.textContent = 'Checking organizer access…';
      try {
        const token = await user.getIdToken();
        const response = await fetch(api + '/me', {
          headers: { Authorization: 'Bearer ' + token },
          signal: AbortSignal.timeout(15000)
        });
        if (current !== revision) return;
        if (response.status === 403) {
          status.textContent = 'This account does not have organizer access. Contact the owner.';
          return;
        }
        if (!response.ok) throw new Error('Access check failed');
        const data = await response.json();
        if (current !== revision) return;
        if (data.uid !== user.uid || !['owner', 'organizer'].includes(data.role)) throw new Error('Invalid access response');
        identity.hidden = false;
        live.enable();
        editor.enable(data.role);
        overview.enable();
        uid.value = user.uid;
        $('organizer-account').textContent = user.email || 'Organizer account';
        status.textContent = data.role === 'owner' ? 'Owner access confirmed.' : 'Organizer access confirmed.';
      } catch {
        if (current === revision) status.textContent = 'Unable to verify organizer access. The organizer API may still need deployment or configuration.';
      }
    }, error => { status.textContent = message(error); });
  } catch {
    status.textContent = 'Unable to load sign-in. Check the Firebase configuration and reload.';
  }
}
$('organizer-copy').addEventListener('click', async () => {
  if (!uid.value) return;
  try { await navigator.clipboard.writeText(uid.value); copyStatus.textContent = 'User ID copied.'; }
  catch { uid.focus(); uid.select(); copyStatus.textContent = 'Copy the selected user ID manually.'; }
});
start();

