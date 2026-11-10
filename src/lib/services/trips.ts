import { getJSON, setJSON } from "./prefs";
import type { Trip } from "../../types";

const TRIPS_KEY = "trips";

export function listTrips(uid: string): Promise<Trip[]> {
  void uid;
  return getJSON<Trip[]>(TRIPS_KEY, []);
}

export async function createTrip(uid: string, name: string): Promise<Trip> {
  void uid;
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("Enter a trip name.");
  const trips = await getJSON<Trip[]>(TRIPS_KEY, []);
  if (trips.some((trip) => trip.name.trim().toLocaleLowerCase() === trimmedName.toLocaleLowerCase())) {
    throw new Error("A trip with this name already exists.");
  }
  const trip: Trip = {
    id: crypto.randomUUID(),
    name: trimmedName,
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

export async function moveExpenseToTrip(expenseId: string, tripId: string): Promise<void> {
  const trips = await getJSON<Trip[]>(TRIPS_KEY, []);
  await setJSON(TRIPS_KEY, trips.map((trip) => {
    const withoutExpense = trip.expenseIds.filter((id) => id !== expenseId);
    return {
      ...trip,
      expenseIds: trip.id === tripId
        ? [...withoutExpense, expenseId]
        : withoutExpense,
    };
  }));
}

export async function restoreTrips(trips: Trip[]): Promise<void> {
  await setJSON(TRIPS_KEY, trips);
}

export async function removeExpensesFromTrips(expenseIds: string[]): Promise<void> {
  const removed = new Set(expenseIds);
  const trips = await getJSON<Trip[]>(TRIPS_KEY, []);
  await setJSON(TRIPS_KEY, trips.map((trip) => ({
    ...trip,
    expenseIds: trip.expenseIds.filter((id) => !removed.has(id)),
  })));
}
