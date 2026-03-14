import { initializeApp, getApps, cert, type App } from "firebase-admin/app";
import { getStorage, type Storage } from "firebase-admin/storage";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

let app: App;
let storage: Storage;
let firestore: Firestore;

function getApp(): App {
  if (!app) {
    app = getApps().length
      ? getApps()[0]
      : initializeApp({
          // On Firebase App Hosting / Cloud Run, ADC is automatic.
          // For local dev, set GOOGLE_APPLICATION_CREDENTIALS or use `gcloud auth application-default login`.
          storageBucket: "studio-4705021877-a1dff.firebasestorage.app",
        });
  }
  return app;
}

export function getAdminStorage(): Storage {
  if (!storage) {
    storage = getStorage(getApp());
  }
  return storage;
}

export function getAdminFirestore(): Firestore {
  if (!firestore) {
    firestore = getFirestore(getApp());
  }
  return firestore;
}
