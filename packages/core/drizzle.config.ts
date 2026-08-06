import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	verbose: true,
	strict: true,
	out: './migrations',
	dialect: 'postgresql',
	schema: './src/**/*.sql.ts',
	dbCredentials: {
		host: process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : 'localhost',
		port: process.env.DATABASE_URL ? Number(new URL(process.env.DATABASE_URL).port || 5432) : 5432,
		user: process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).username : 'postgres',
		password: process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).password : 'postgres',
		database: process.env.DATABASE_URL
			? new URL(process.env.DATABASE_URL).pathname.slice(1)
			: 'nestri',
		ssl: !!process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
	}
});
