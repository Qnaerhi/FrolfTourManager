import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { type Firestore, getFirestore } from "firebase-admin/firestore";
import { config } from "./config.js";

let initialized = false;
let firestoreInstance: Firestore | null = null;

function initializeFirebaseAdmin() {
  if (initialized || getApps().length > 0) {
    initialized = true;
    return;
  }

  const hasServiceAccount =
    Boolean(config.firebaseProjectId) &&
    Boolean(config.firebaseClientEmail) &&
    Boolean(config.firebasePrivateKey);

  if (hasServiceAccount) {
    const projectId = config.firebaseProjectId!;
    const clientEmail = config.firebaseClientEmail!;
    const privateKey = config.firebasePrivateKey!;
    initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
      projectId,
    });
  } else {
    initializeApp({
      credential: applicationDefault(),
      ...(config.firebaseProjectId ? { projectId: config.firebaseProjectId } : {}),
    });
  }

  initialized = true;
}

export async function connectToDatabase() {
  return getDb();
}

export function getDb() {
  initializeFirebaseAdmin();
  if (!firestoreInstance) {
    firestoreInstance = getFirestore();
    firestoreInstance.settings({ ignoreUndefinedProperties: true });
  }
  return firestoreInstance;
}

export function getFirebaseAuth() {
  initializeFirebaseAdmin();
  return getAuth();
}
