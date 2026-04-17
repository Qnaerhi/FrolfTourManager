import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

function requireEnv(name: string): string {
  const value = import.meta.env[name as keyof ImportMetaEnv];
  if (!value) {
    throw new Error(`Missing required Firebase env var: ${name}`);
  }
  return value;
}

const firebaseConfig = {
  apiKey: requireEnv("VITE_FIREBASE_API_KEY"),
  authDomain: requireEnv("VITE_FIREBASE_AUTH_DOMAIN"),
  projectId: requireEnv("VITE_FIREBASE_PROJECT_ID"),
  storageBucket: requireEnv("VITE_FIREBASE_STORAGE_BUCKET"),
  messagingSenderId: requireEnv("VITE_FIREBASE_MESSAGING_SENDER_ID"),
  appId: requireEnv("VITE_FIREBASE_APP_ID"),
};

const firebaseApp = initializeApp(firebaseConfig);

export const auth = getAuth(firebaseApp);
