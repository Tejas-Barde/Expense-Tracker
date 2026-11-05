import { getJSON, setJSON } from "./prefs";
import type { Trip } from "../../types";

const TRIPS_KEY = "trips";

export function listTrips(uid: string): Promise<Trip[]> {
  void uid;
  return getJSON<Trip[]>(TRIPS_KEY, []);
}

export async function createTrip(uid: string, name: string): Promise<Trip> {
  void uid;
  const trips = await getJSON<Trip[]>(TRIPS_KEY, []);
  const trip: Trip = {
    id: crypto.randomUUID(),
    name: name.trim(),
    timestamp: new Date().toISOString(),
    expenseIds: [],
  };
  await setJSON(TRIPS_KEY, [...trips, trip]);
  return trip;
}

export async function addExpenseToTrip(tripId: string, expenseId: string): Promise<void> {
  const trips = await getJSON<Trip[]>(TRIPS_KEY, []);
  await setJSON(TRIPS_KEY, trips.map((trip) =>
    trip.id === tripId && !trip.expenseIds.includes(expenseId)
      ? { ...trip, expenseIds: [...trip.expenseIds, expenseId] }
      : trip));
}

export async function removeExpensesFromTrips(expenseIds: string[]): Promise<void> {
  const removed = new Set(expenseIds);
  const trips = await getJSON<Trip[]>(TRIPS_KEY, []);
  await setJSON(TRIPS_KEY, trips.map((trip) => ({
    ...trip,
    expenseIds: trip.expenseIds.filter((id) => !removed.has(id)),
  })));
}
