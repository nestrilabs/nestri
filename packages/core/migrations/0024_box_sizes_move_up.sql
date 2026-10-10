ALTER TABLE "box" ALTER COLUMN "tier" SET DEFAULT 'md';--> statement-breakpoint
-- Every size moved up one and each resolution kept its price: a box that was
-- `sm` (1080p) is now `md`, and so on up to `lg` (4K), now `xl`. An `xl` box
-- stays `xl`: it was 4K at 120 Hz and is 4K.
UPDATE "box" SET "tier" = (CASE "tier"::text WHEN 'xs' THEN 'sm' WHEN 'sm' THEN 'md' WHEN 'md' THEN 'lg' ELSE 'xl' END)::"box_tier";
