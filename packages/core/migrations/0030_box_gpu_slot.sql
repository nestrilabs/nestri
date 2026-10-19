ALTER TABLE "box" ADD COLUMN "gpu_slot" text;
--> statement-breakpoint
-- Boxes made before a box named its card hold one card of their machine.
-- Where the machine has exactly one GPU that card is known, so name it.
UPDATE "box" SET "gpu_pci_id" = m."gpus"->0->>'pciId'
FROM "machine" m
WHERE "box"."machine_id" = m."id"
  AND "box"."gpu_pci_id" IS NULL
  AND m."organisation_id" IS NOT NULL
  AND jsonb_typeof(m."gpus") = 'array'
  AND jsonb_array_length(m."gpus") = 1;
