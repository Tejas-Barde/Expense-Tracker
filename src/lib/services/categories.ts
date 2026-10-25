import { ID } from "../appwrite/client";
import { getJSON, setJSON } from "./prefs";
import type { Category } from "../../types";
const DEFAULTS = [["Food","#f97316"],["Cab/Travel","#38bdf8"],["Shopping/Clothes","#e879f9"],["Utilities","#a3e635"],["Entertainment","#f43f5e"],["Subscriptions","#facc15"]];
const CATEGORY_COLORS = ["#f97316", "#0ea5e9", "#a855f7", "#84cc16", "#f43f5e", "#f59e0b", "#2563eb", "#db2777", "#0891b2", "#7c3aed", "#16a34a", "#dc2626", "#4f46e5", "#ca8a04"];

function generatedColor(index: number) {
  const hue = (index * 137.508) % 360;
  const saturation = 0.72, lightness = 0.48;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = lightness - chroma / 2;
  const [r, g, b] = hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x] : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x];
  return `#${[r, g, b].map((value) => Math.round((value + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}

export function nextCategoryColor(categories: Category[], preferredColor?: string) {
  const used = new Set(categories.map((category) => category.color.toLowerCase()));
  if (preferredColor && !used.has(preferredColor.toLowerCase())) return preferredColor;
  const available = CATEGORY_COLORS.find((color) => !used.has(color));
  if (available) return available;
  let index = categories.length;
  let color = generatedColor(index);
  while (used.has(color)) color = generatedColor(++index);
  return color;
}

export async function listCategories(uid: string): Promise<Category[]> {
  let cats = await getJSON<Category[]>("categories", []);
  if (!cats.length) { // seed system defaults on first login
    cats = DEFAULTS.map(([name, color]) => ({ $id: ID.unique(), userId: uid, name, color, isDefault: true }));
    await setJSON("categories", cats);
  }
  const uniqueCats: Category[] = [];
  for (const category of cats) {
    const color = nextCategoryColor(uniqueCats, category.color);
    uniqueCats.push(color === category.color ? category : { ...category, color });
  }
  if (uniqueCats.some((category, index) => category.color !== cats[index].color)) {
    await setJSON("categories", uniqueCats);
  }
  return uniqueCats;
}
export async function addCategory(uid: string, name: string, color: string) {
  const cats = await listCategories(uid);
  const distinctColor = nextCategoryColor(cats, color);
  await setJSON("categories", [...cats, { $id: ID.unique(), userId: uid, name, color: distinctColor, isDefault: false }]);
}
