# Appwrite setup (1 database, 1 table)

Only `expenses` is a table. Categories and budgets are stored in each user's Auth prefs, and name/email live in Appwrite Auth.

1. **Project** → add a **Web platform** (hostname `localhost` + your production domain).
2. **Auth** → Settings → enable *Email/Password*.
3. **Database** → create one database; copy its ID to `VITE_APPWRITE_DATABASE_ID`.
4. **Table** `expenses` → copy its table ID to `VITE_TABLE_EXPENSES`. Use the table ID, not its display name.
5. **Columns** (wait until all show *Available*):

| Key | Type | Size | Required |
|---|---|---|---|
| `userId` | String | 36 | Yes |
| `amount` | Float | – | Yes |
| `categoryId` | String | 36 | Yes |
| `note` | String | 500 | No |
| `timestamp` | Datetime | – | Yes |

6. **Indexes**: `userId_idx` (Key, `userId`); `timestamp_idx` (Key, `timestamp`, DESC).
7. **Table permissions**: allow authenticated users to create rows, and turn on row security. The app grants each row read, update, and delete permissions only to its owner.
8. `cp .env.example .env`, fill the three values, then `npm install && npm run dev`.
