ALTER TABLE "machine" ADD COLUMN "slots" integer;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "time_seen" timestamp with time zone;