import { closeDb, initDb } from "../lib/db";

async function main() {
  await initDb();
  console.log("Postgres schema is ready.");
  await closeDb();
}

main().catch((error) => {
  console.error("Database migration failed:", error);
  process.exit(1);
});
