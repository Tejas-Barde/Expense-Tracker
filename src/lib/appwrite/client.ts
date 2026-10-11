import { Client, Account, TablesDB, ID, Query, Permission, Role } from "appwrite";

const requireEnv = (name: string, value: string | undefined) => {
  if (!value?.trim()) {
    throw new Error(`Missing ${name}. Add it to your .env file and restart the Vite server.`);
  }

  return value.trim();
};

const endpoint = requireEnv("VITE_APPWRITE_ENDPOINT", import.meta.env.VITE_APPWRITE_ENDPOINT);
const projectId = requireEnv("VITE_APPWRITE_PROJECT_ID", import.meta.env.VITE_APPWRITE_PROJECT_ID);
const databaseId = requireEnv("VITE_APPWRITE_DATABASE_ID", import.meta.env.VITE_APPWRITE_DATABASE_ID);
const expensesTableId = requireEnv(
  "VITE_TABLE_EXPENSES",
  import.meta.env.VITE_TABLE_EXPENSES || import.meta.env.VITE_COL_EXPENSES,
);

export const client = new Client().setEndpoint(endpoint).setProject(projectId);
export const account = new Account(client);
export const tablesDB = new TablesDB(client);
export const DB = databaseId;
export const TABLE = { expenses: expensesTableId };
/** Row-level permissions scoped strictly to the owner. */
export const ownerPerms = (uid: string) => [
  Permission.read(Role.user(uid)), Permission.update(Role.user(uid)), Permission.delete(Role.user(uid)),
];
export { ID, Query };
