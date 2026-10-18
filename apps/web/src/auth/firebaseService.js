import { initializeApp } from '@firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from '@firebase/auth';

/**
 * The only file that talks to the Firebase browser SDK. It exposes a tiny interface so the rest of
 * the app (and the tests) never depend on Firebase directly:
 *   onChange(cb)         cb(true|false) whenever someone signs in or out
 *   signIn(email, pass)  throws a Firebase error with a `code` on failure
 *   signOut()
 *   getToken(force)      current ID token (force=true asks Firebase for a fresh one)
 * Returns null when the VITE_FIREBASE_* values are missing, so the UI can say so honestly.
 */
export function createFirebaseService(env = import.meta.env) {
  const apiKey = env.VITE_FIREBASE_API_KEY;
  const projectId = env.VITE_FIREBASE_PROJECT_ID;
  if (!apiKey || !projectId) return null;

  const app = initializeApp({
    apiKey,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId,
    appId: env.VITE_FIREBASE_APP_ID,
  });
  const auth = getAuth(app);
  if (env.VITE_FIREBASE_AUTH_EMULATOR) {
    connectAuthEmulator(auth, env.VITE_FIREBASE_AUTH_EMULATOR, { disableWarnings: true });
  }

  return {
    onChange: (cb) => onAuthStateChanged(auth, (user) => cb(Boolean(user))),
    signIn: (email, password) => signInWithEmailAndPassword(auth, email, password),
    signOut: () => firebaseSignOut(auth),
    getToken: async (force = false) =>
      auth.currentUser ? auth.currentUser.getIdToken(force) : null,
  };
}
