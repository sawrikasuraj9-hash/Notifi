import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithCredential,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  User as FirebaseUser,
  updateProfile,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  updateDoc,
  query,
  where,
  orderBy,
  setLogLevel,
} from 'firebase/firestore/lite';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

// Use Firestore Lite (pure HTTPS REST fetch transport) with the named database ID.
// This app performs one-shot reads/writes (no realtime onSnapshot listeners), so REST avoids
// persistent WebChannel Listen streams that stall for 10s behind mobile/carrier/iframe proxies.
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export { firebaseConfig };

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// In-memory only server-signed session token (NEVER persisted to localStorage or sessionStorage)
let inMemoryServerSessionToken: string | null = null;

export function setServerSessionToken(token: string | null): void {
  inMemoryServerSessionToken = token && token.trim() ? token.trim() : null;
}

export function getServerSessionToken(): string | null {
  return inMemoryServerSessionToken;
}

/**
 * Authenticated fetch wrapper that automatically attaches the signed-in user's
 * Firebase ID token (or server-signed owner session token) as an Authorization Bearer header
 * on same-origin /api/* calls without mutating window.fetch.
 */
export async function authFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  try {
    const urlStr =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    const isSameOriginApi =
      urlStr.startsWith('/api/') ||
      (typeof window !== 'undefined' && urlStr.startsWith(`${window.location.origin}/api/`));

    if (isSameOriginApi) {
      const headers = new Headers(
        init?.headers || (input instanceof Request ? input.headers : undefined)
      );
      if (!headers.has('Authorization')) {
        if (auth.currentUser) {
          const idToken = await auth.currentUser.getIdToken();
          if (idToken) {
            headers.set('Authorization', `Bearer ${idToken}`);
          }
        } else if (inMemoryServerSessionToken) {
          headers.set('Authorization', `Bearer ${inMemoryServerSessionToken}`);
        }
      }
      return fetch(input, { ...init, headers });
    }
  } catch {
    // Fall through to standard fetch if token retrieval fails transiently
  }
  return fetch(input, init);
}

// Suppress noisy internal SDK console.error logs on transient mobile/browser network drops
// (e.g. "RPC_ERROR HTTP error has no status" when fetch fails offline); real permission & app errors
// are surfaced explicitly via handleFirestoreError().
setLogLevel('silent');

// Validate connection to Firestore backend safely in background via direct server REST read
async function testConnection() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return;
  }
  try {
    await getDoc(doc(db, 'test', 'connection'));
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Please check your Firebase configuration or network connection.');
    }
  }
}

if (typeof window !== 'undefined') {
  setTimeout(() => {
    void testConnection();
  }, 1000);
}

// Custom parameters to make Google Login crisp and prompt account selection
googleProvider.setCustomParameters({
  prompt: 'select_account',
});

export {
  signInWithPopup,
  signInWithCredential,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  updateDoc,
  query,
  where,
  orderBy,
};
export type { FirebaseUser };
