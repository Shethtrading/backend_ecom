require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const migrationsDir = path.join(__dirname, "..", "migrations");

async function runMigrations() {
  const client = new Client({
    connectionString: process.env.DB_CONNECTION_STRING,
    ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });

  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        filename TEXT UNIQUE NOT NULL,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const files = fs
      .readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .sort((a, b) => a.localeCompare(b));

    for (const filename of files) {
      const check = await client.query(
        "SELECT 1 FROM schema_migrations WHERE filename = $1 LIMIT 1",
        [filename]
      );

      if (check.rowCount > 0) {
        console.log(`Skipping already executed migration: ${filename}`);
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, filename), "utf8");
      console.log(`Running migration: ${filename}`);

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (filename) VALUES ($1)",
          [filename]
        );
        await client.query("COMMIT");
        console.log(`Migration completed: ${filename}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }

    console.log("All migrations are up to date.");
  } finally {
    await client.end();
  }
}

runMigrations().catch((error) => {
  console.error("Migration failed:", error.message);
  process.exit(1);
});
