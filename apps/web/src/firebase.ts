import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

function readEnv(name: keyof ImportMetaEnv): string | undefined {
  const value = import.meta.env[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function isFirebaseClientConfigured(): boolean {
  return Boolean(
    readEnv("VITE_FIREBASE_API_KEY") &&
      readEnv("VITE_FIREBASE_AUTH_DOMAIN") &&
      readEnv("VITE_FIREBASE_PROJECT_ID") &&
      readEnv("VITE_FIREBASE_STORAGE_BUCKET") &&
      readEnv("VITE_FIREBASE_MESSAGING_SENDER_ID") &&
      readEnv("VITE_FIREBASE_APP_ID"),
  );
}

let firebaseApp: FirebaseApp | undefined;
let authInstance: Auth | undefined;

/**
 * Lazily initializes Firebase Auth when all `VITE_FIREBASE_*` env vars are set.
 * Returns `null` in local dev if `.env` is missing so the app shell can still render.
 */
export function getWebAuth(): Auth | null {
  if (!isFirebaseClientConfigured()) {
    return null;
  }

  if (!authInstance) {
    firebaseApp = initializeApp({
      apiKey: readEnv("VITE_FIREBASE_API_KEY")!,
      authDomain: readEnv("VITE_FIREBASE_AUTH_DOMAIN")!,
      projectId: readEnv("VITE_FIREBASE_PROJECT_ID")!,
      storageBucket: readEnv("VITE_FIREBASE_STORAGE_BUCKET")!,
      messagingSenderId: readEnv("VITE_FIREBASE_MESSAGING_SENDER_ID")!,
      appId: readEnv("VITE_FIREBASE_APP_ID")!,
    });
    authInstance = getAuth(firebaseApp);
  }

  return authInstance;
}
