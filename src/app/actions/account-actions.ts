"use server";

import { getAdminFirestore } from "@/lib/firebase-admin";

const USERS_COLLECTION = "users";

interface UserRecord {
  email: string;
  name: string | null;
  provider: string;
  providerId: string;
  createdAt: string;
  lastLoginAt: string;
}

interface DuplicateCheckResult {
  isDuplicate: boolean;
  existingAccounts: {
    provider: string;
    email: string;
    createdAt: string;
  }[];
  message: string;
}

/**
 * Record a user login and check for duplicate accounts.
 * A "duplicate" is defined as multiple accounts with the same email
 * but different OAuth providers (e.g., Google + Apple with same email).
 */
export async function recordLoginAndCheckDuplicates(user: {
  email: string;
  name: string | null;
  provider: string;
  providerId: string;
}): Promise<DuplicateCheckResult> {
  if (!user.email) {
    return { isDuplicate: false, existingAccounts: [], message: "No email provided" };
  }

  try {
    const db = getAdminFirestore();
    const usersRef = db.collection(USERS_COLLECTION);
    const normalizedEmail = user.email.toLowerCase().trim();

    // Upsert the current user's record
    const docId = `${user.provider}_${normalizedEmail.replace(/[^a-z0-9]/g, "_")}`;
    const now = new Date().toISOString();

    await usersRef.doc(docId).set(
      {
        email: normalizedEmail,
        name: user.name,
        provider: user.provider,
        providerId: user.providerId,
        lastLoginAt: now,
        createdAt: now, // only set on first write
      } satisfies UserRecord,
      { merge: true }
    );

    // Don't overwrite createdAt on subsequent logins
    const existing = await usersRef.doc(docId).get();
    if (existing.exists && existing.data()?.createdAt) {
      // createdAt already set, don't overwrite
    } else {
      await usersRef.doc(docId).update({ createdAt: now });
    }

    // Check for duplicate accounts with the same email but different providers
    const snapshot = await usersRef
      .where("email", "==", normalizedEmail)
      .get();

    const accounts = snapshot.docs.map((doc) => {
      const data = doc.data() as UserRecord;
      return {
        provider: data.provider,
        email: data.email,
        createdAt: data.createdAt,
      };
    });

    const uniqueProviders = new Set(accounts.map((a) => a.provider));

    if (uniqueProviders.size > 1) {
      return {
        isDuplicate: true,
        existingAccounts: accounts,
        message: `Duplicate accounts detected: ${normalizedEmail} is registered with ${Array.from(uniqueProviders).join(", ")}. Consider linking these accounts.`,
      };
    }

    return {
      isDuplicate: false,
      existingAccounts: accounts,
      message: "No duplicate accounts found",
    };
  } catch (error) {
    console.error("[account-actions] duplicate check failed:", error);
    return {
      isDuplicate: false,
      existingAccounts: [],
      message: "Duplicate check failed — continuing anyway",
    };
  }
}

/**
 * Find all accounts associated with a given email address.
 */
export async function findAccountsByEmail(email: string): Promise<{
  accounts: { provider: string; email: string; name: string | null; createdAt: string; lastLoginAt: string }[];
}> {
  if (!email) return { accounts: [] };

  try {
    const db = getAdminFirestore();
    const normalizedEmail = email.toLowerCase().trim();

    const snapshot = await db
      .collection(USERS_COLLECTION)
      .where("email", "==", normalizedEmail)
      .get();

    const accounts = snapshot.docs.map((doc) => {
      const data = doc.data() as UserRecord;
      return {
        provider: data.provider,
        email: data.email,
        name: data.name,
        createdAt: data.createdAt,
        lastLoginAt: data.lastLoginAt,
      };
    });

    return { accounts };
  } catch (error) {
    console.error("[account-actions] findAccountsByEmail failed:", error);
    return { accounts: [] };
  }
}
