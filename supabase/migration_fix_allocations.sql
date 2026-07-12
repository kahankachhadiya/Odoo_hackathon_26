-- Fix for allocations table: Add created_at column if missing
-- This is a patch for databases that were created with the original migration

-- Add created_at column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'allocations' 
      AND column_name = 'created_at'
  ) THEN
    ALTER TABLE allocations 
    ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();
    
    RAISE NOTICE 'Added created_at column to allocations table';
  ELSE
    RAISE NOTICE 'created_at column already exists in allocations table';
  END IF;
END $$;
