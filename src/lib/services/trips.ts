import { getJSON, mutateJSON, setJSON } from "./prefs";
import type { Trip } from "../../types";

const TRIPS_KEY = "trips";

// Every change goes through mutateJSON, which reads, changes and writes inside one queue,
// so two quick edits (for example deleting one transaction while adding another) cannot overwrite each other.
const mutateTrips = (change: (trips: Trip[]) => Trip[]) => mutateJSON<Trip[]>(TRIPS_KEY, change, []);

export function listTrips(uid: string): Promise<Trip[]> {
  void uid;
  return getJSON<Trip[]>(TRIPS_KEY, []);
}

export async function createTrip(uid: string, name: string): Promise<Trip> {
  void uid;
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("Enter a trip name.");
  let created!: Trip;
  await mutateTrips((trips) => {
    if (trips.some((trip) => trip.name.trim().toLocaleLowerCase() === trimmedName.toLocaleLowerCase())) {
      throw new Error("A trip with this name already exists.");
    }
    created = { id: crypto.randomUUID(), name: trimmedName, timestamp: new Date().toISOString(), expenseIds: [] };
    return [...trips, created];
  });
  return created;
}

export async function addExpenseToTrip(tripId: string, expenseId: string): Promise<void> {
  await mutateTrips((trips) => trips.map((trip) =>
    trip.id === tripId && !trip.expenseIds.includes(expenseId)
      ? { ...trip, expenseIds: [...trip.expenseIds, expenseId] }
      : trip));
}

export async function moveExpenseToTrip(expenseId: string, tripId: string): Promise<void> {
  await mutateTrips((trips) => trips.map((trip) => {
    const withoutExpense = trip.expenseIds.filter((id) => id !== expenseId);
    return { ...trip, expenseIds: trip.id === tripId ? [...withoutExpense, expenseId] : withoutExpense };
  }));
}

export async function restoreTrips(trips: Trip[]): Promise<void> {
  await setJSON(TRIPS_KEY, trips);
}

export async function removeExpensesFromTrips(expenseIds: string[]): Promise<void> {
  const removed = new Set(expenseIds);
  await mutateTrips((trips) => trips.map((trip) => ({
    ...trip,
    expenseIds: trip.expenseIds.filter((id) => !removed.has(id)),
  })));
}

/** Deletes a trip. Its transactions are kept and go back to counting in their normal categories. */
export async function deleteTrip(tripId: string): Promise<void> {
  await mutateTrips((trips) => trips.filter((trip) => trip.id !== tripId));
}
