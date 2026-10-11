import { account } from "../appwrite/client";
// Categories and budgets live in the user's Appwrite Auth prefs (private to the user, no extra collection).
export async function getJSON<T>(key: string, fallback: T): Promise<T> {
  const p = (await account.getPrefs()) as Record<string, string>;
  try { return p[key] ? (JSON.parse(p[key]) as T) : fallback; } catch { return fallback; }
}
export async function setJSON(key: string, value: unknown) {
  const p = await account.getPrefs(); // updatePrefs replaces everything, so merge first
  await account.updatePrefs({ ...p, [key]: JSON.stringify(value) });
}
