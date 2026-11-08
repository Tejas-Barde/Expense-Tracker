import { account } from "../appwrite/client";
// Categories and budgets live in the user's Appwrite Auth prefs (private to the user, no extra collection).
let prefsMutationQueue: Promise<void> = Promise.resolve();

function queuePrefsMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = prefsMutationQueue.then(operation, operation);
  prefsMutationQueue = result.then(() => undefined, () => undefined);
  return result;
}

export async function getJSON<T>(key: string, fallback: T): Promise<T> {
  const p = (await account.getPrefs()) as Record<string, string>;
  try { return p[key] ? (JSON.parse(p[key]) as T) : fallback; } catch { return fallback; }
}
export async function setJSON(key: string, value: unknown) {
  await queuePrefsMutation(async () => {
    const p = await account.getPrefs();
    await account.updatePrefs({ ...p, [key]: JSON.stringify(value) });
  });
}

export async function mutateJSON<T>(key: string, mutation: (current: T) => T, fallback: T): Promise<T> {
  return queuePrefsMutation(async () => {
    const p = await account.getPrefs() as Record<string, string>;
    let current = fallback;
    try {
      if (p[key]) current = JSON.parse(p[key]) as T;
    } catch {
      current = fallback;
    }
    const updated = mutation(current);
    await account.updatePrefs({ ...p, [key]: JSON.stringify(updated) });
    return updated;
  });
}
