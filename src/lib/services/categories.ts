import { ID } from "../appwrite/client";
import { getJSON, setJSON } from "./prefs";
import type { Category } from "../../types";
const DEFAULTS = [["Food","#f97316"],["Cab/Travel","#38bdf8"],["Shopping/Clothes","#e879f9"],["Utilities","#a3e635"],["Entertainment","#f43f5e"],["Subscriptions","#facc15"]];
export async function listCategories(uid: string): Promise<Category[]> {
  let cats = await getJSON<Category[]>("categories", []);
  if (!cats.length) { // seed system defaults on first login
    cats = DEFAULTS.map(([name, color]) => ({ $id: ID.unique(), userId: uid, name, color, isDefault: true }));
    await setJSON("categories", cats);
  }
  return cats;
}
export async function addCategory(uid: string, name: string, color: string) {
  const cats = await getJSON<Category[]>("categories", []);
  await setJSON("categories", [...cats, { $id: ID.unique(), userId: uid, name, color, isDefault: false }]);
}
