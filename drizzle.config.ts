import type { Config } from "drizzle-kit";

export default {
	dialect: "sqlite",
	schema: "./src/db/schema.ts",
	out: "./migrations",
	driver: "d1",
	dbCredentials: {
		wranglerConfigPath: "./wrangler.jsonc",
		dbName: "repomind-db",
	},
} satisfies Config;
