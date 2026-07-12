# Implementation Plan: AssetFlow Stage 2 — Asset Core & Allocation Engine

## Overview

Implement the Stage 2 asset management layer on top of the existing Stage 1 Supabase infrastructure. Work proceeds in five waves: database migration → TypeScript types & DB types → service layer → UI components → pages & routing. The partial unique index and status-sync trigger are the database's correctness backbone; all application code treats the DB as the source of truth.

**Key constraints:**
- Never modify `supabase/schema.sql` — all DB changes go in `supabase/migration_stage2_assets_allocation.sql`
- TypeScript strict mode, zero `any` types
- Follow Stage 1 patterns: `SECURITY DEFINER` helpers, `AFTER` triggers, RLS on every table
- Test framework: Vitest + fast-check + React Testing Library (install as needed)

---

## Tasks

- [x] 1. Write the Stage 2 database migration file
  - Create `supabase/migration_stage2_assets_allocation.sql` (additive only — never touch schema.sql)
  - Add a prerequisite guard: verify `profiles`, `departments`, and `asset_categories` tables exist before proceeding
  - Create sequence `asset_tag_seq` with `START 1 INCREMENT 1` using `CREATE SEQUENCE IF NOT EXISTS`
  - Create enum `asset_status` ('Available', 'Allocated', 'Reserved', 'Under Maintenance', 'Lost', 'Retired', 'Disposed')
  - Create enum `transfer_request_status` ('Pending', 'Approved', 'Rejected')
  - Create `assets` table with all columns, CHECK constraints, and `DEFAULT 'AF-' || LPAD(nextval('asset_tag_seq')::TEXT, 4, '0')` for `tag`
  - Create `allocations` table with `ON DELETE RESTRICT` on all three UUID FKs
  - Create `transfer_requests` table with `ON DELETE CASCADE` on asset_id, requested_by, current_holder; `CHECK (char_length(TRIM(reason)) > 0 AND char_length(reason) <= 1000)`
  - Create partial unique index `only_one_active_allocation ON allocations(asset_id) WHERE returned_at IS NULL`
  - Create `is_asset_manager()` SECURITY DEFINER function (mirrors `is_admin()` — checks role IN ('Admin', 'Asset Manager'))
  - Create `sync_asset_status()` SECURITY DEFINER trigger function: INSERT with returned_at IS NULL → set status 'Allocated'; UPDATE setting returned_at non-NULL → set status 'Available'
  - Attach trigger `on_allocation_change` AFTER INSERT OR UPDATE ON allocations FOR EACH ROW
  - Enable RLS on `assets`, `allocations`, `transfer_requests`
  - RLS policies for `assets`: SELECT authenticated, INSERT/UPDATE/DELETE via `is_asset_manager()`
  - RLS policies for `allocations`: SELECT authenticated; INSERT/UPDATE for Admin/Asset Manager/Department Head; DELETE denied (WITH CHECK (false))
  - RLS policies for `transfer_requests`: SELECT authenticated; INSERT authenticated; UPDATE status for Asset Manager/Admin; UPDATE status for Department Head scoped to their department; DELETE denied
  - Add commented rollback statements at the bottom for manual recovery
  - _Requirements: 1, 2, 3, 4, 5, 6, 7, 8, 9, 16, 17, 20_

- [x] 2. Extend TypeScript types and database type definitions
  - [x] 2.1 Add Stage 2 domain types to `src/types/index.ts`
    - Add `AssetStatus` and `TransferRequestStatus` union types
    - Add `Asset`, `AssetWithCategory`, `Allocation`, `AllocationWithProfiles`, `TransferRequest` interfaces
    - Add `CreateAssetInput`, `CreateAllocationInput`, `CreateTransferRequestInput` input interfaces
    - Add `AllocationConflictError` and `DuplicateSerialError` typed error classes (extend `Error`, set `this.name`)
    - _Requirements: 2, 3, 4_

  - [x] 2.2 Extend `src/lib/database.types.ts` with Stage 2 tables
    - Add `assets`, `allocations`, `transfer_requests` Row/Insert/Update shapes to the `Tables` object
    - Add `asset_status` and `transfer_request_status` to the `Enums` object
    - Add `is_asset_manager` to the `Functions` object
    - Keep all Stage 1 types untouched
    - _Requirements: 2, 3, 4_

- [ ] 3. Implement the asset service
  - [ ] 3.1 Create `src/services/assetService.ts`
    - Implement `listAssets(): Promise<AssetWithCategory[]>` — SELECT assets JOIN asset_categories, return typed array
    - Implement `searchAssets(query: string): Promise<AssetWithCategory[]>` — ilike on tag and name columns with OR, min 2 chars enforced by caller
    - Implement `createAsset(input: CreateAssetInput): Promise<Asset>` — INSERT omitting `tag` so DB default fires; catch error code `23505` where detail includes "serial_number" and re-throw `DuplicateSerialError`
    - Use strict types throughout — no `any`; destructure Supabase response into typed variables
    - _Requirements: 10.6, 10.7, 11, 12.1, 12.2_

  - [ ]* 3.2 Write unit tests for `assetService.ts`
    - Mock `src/lib/supabaseClient` with `vi.mock`
    - Test `listAssets` returns correctly shaped `AssetWithCategory[]`
    - Test `createAsset` happy path returns created `Asset`
    - Test `createAsset` throws `DuplicateSerialError` on code `23505` with serial_number in detail
    - Test `searchAssets` passes ilike query correctly
    - _Requirements: 10.6, 10.7_

  - [ ]* 3.3 Write property test — P6: new asset defaults (fast-check)
    - **Property 6: Asset registration always starts as Available**
    - Generate arbitrary valid `CreateAssetInput` values (name, category_id as UUID, optional serial/condition/location)
    - Assert that any inserted asset row has `status === 'Available'` and `is_bookable === false`
    - Tag comment: `// Feature: assetflow-stage2, Property 6`
    - **Validates: Requirements 2.3, 2.4, 18.1**

  - [ ]* 3.4 Write property test — P7: serial number uniqueness (fast-check)
    - **Property 7: Serial number uniqueness — NULL is not a conflict**
    - Generate pairs of assets: one set where both serials are NULL (should succeed), one set where both share a non-NULL serial (second should be rejected with unique violation)
    - Tag comment: `// Feature: assetflow-stage2, Property 7`
    - **Validates: Requirements 2.5, 20.1**

- [ ] 4. Implement the allocation service
  - [ ] 4.1 Create `src/services/allocationService.ts`
    - Implement `getAllocationsForAsset(assetId: string): Promise<AllocationWithProfiles[]>` — SELECT allocations JOIN profiles twice (assigned_to, assigned_by), order by created_at DESC
    - Implement `getActiveAllocation(assetId: string): Promise<AllocationWithProfiles | null>` — filter WHERE returned_at IS NULL, single row
    - Implement `createAllocation(input: CreateAllocationInput): Promise<Allocation>` — INSERT with returned_at omitted; catch error code `23505` and re-throw `AllocationConflictError`
    - Implement `returnAllocation(allocationId: string): Promise<void>` — UPDATE set returned_at = now()
    - Implement `createTransferRequest(input: CreateTransferRequestInput): Promise<TransferRequest>` — INSERT into transfer_requests
    - Implement `getPendingTransferForAsset(assetId: string, requestedBy: string): Promise<TransferRequest | null>` — SELECT WHERE asset_id, requested_by, status = 'Pending'
    - Implement `approveTransferRequest(transferRequestId: string, newHolderId: string): Promise<void>` — atomically: return current allocation (set returned_at), create new allocation for newHolderId, update request status to 'Approved'
    - Implement `rejectTransferRequest(transferRequestId: string): Promise<void>` — UPDATE status to 'Rejected'
    - _Requirements: 13.3, 14.3, 15.1, 15.2, 15.3, 19_

  - [ ]* 4.2 Write unit tests for `allocationService.ts`
    - Mock `src/lib/supabaseClient` with `vi.mock`
    - Test `createAllocation` happy path
    - Test `createAllocation` throws `AllocationConflictError` on code `23505`
    - Test `getActiveAllocation` returns null when no active allocation exists
    - Test `approveTransferRequest` calls update + insert + update in sequence
    - _Requirements: 13.3, 13.5, 19.2_

  - [ ]* 4.3 Write property test — P1: asset tag format and uniqueness (fast-check)
    - **Property 1: Asset tag format and uniqueness**
    - Generate batch sizes N ∈ [1, 20]; insert N assets; retrieve their tags
    - Assert every tag matches `/^AF-\d{4,}$/` and all tags in the batch are distinct
    - Tag comment: `// Feature: assetflow-stage2, Property 1`
    - **Validates: Requirements 1.2, 1.3, 1.4, 17.1, 17.2, 17.4**

  - [ ]* 4.4 Write property test — P2: double allocation blocked (fast-check)
    - **Property 2: At most one active allocation per asset**
    - For any asset, inserting a second allocation with returned_at IS NULL while one is active shall be rejected (unique constraint violation, code 23505)
    - Tag comment: `// Feature: assetflow-stage2, Property 2`
    - **Validates: Requirements 5.1, 5.2, 5.4, 20.2**

  - [ ]* 4.5 Write property test — P3: re-allocation permitted after return (fast-check)
    - **Property 3: Re-allocation is permitted after return**
    - Sequence: insert allocation (returned_at NULL) → update returned_at to timestamp → insert new allocation (returned_at NULL) — all three operations must succeed
    - Tag comment: `// Feature: assetflow-stage2, Property 3`
    - **Validates: Requirements 5.3, 18.3**

  - [ ]* 4.6 Write property test — P4: allocation sets status to Allocated (fast-check)
    - **Property 4: Allocation sets asset status to Allocated**
    - For any asset, after inserting an allocation with returned_at IS NULL, assets.status must equal 'Allocated'
    - Tag comment: `// Feature: assetflow-stage2, Property 4`
    - **Validates: Requirements 6.2, 18.2**

  - [ ]* 4.7 Write property test — P5: return sets status to Available (fast-check)
    - **Property 5: Return sets asset status to Available**
    - For any active allocation, after UPDATE setting returned_at to a non-NULL timestamp, assets.status must equal 'Available'
    - Tag comment: `// Feature: assetflow-stage2, Property 5`
    - **Validates: Requirements 6.3, 18.3**

  - [ ]* 4.8 Write property test — P8: blank transfer reason rejected (fast-check)
    - **Property 8: Transfer request reason cannot be blank**
    - Generate strings composed entirely of whitespace (spaces, tabs, newlines); attempt INSERT into transfer_requests; assert DB rejects with CHECK constraint error
    - Tag comment: `// Feature: assetflow-stage2, Property 8`
    - **Validates: Requirements 4.3**

  - [ ]* 4.9 Write property test — P15: transfer approval atomically swaps allocation (fast-check)
    - **Property 15: Transfer approval atomically swaps the allocation**
    - After approving a transfer request, exactly one active allocation (returned_at IS NULL) must exist for the asset (assigned to the requesting user), and the previous holder's allocation must have a non-NULL returned_at
    - Tag comment: `// Feature: assetflow-stage2, Property 15`
    - **Validates: Requirements 19.2, 19.3**

- [ ] 5. Checkpoint — services and DB layer complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Build the RegisterAssetModal component
  - [ ] 6.1 Create `src/components/RegisterAssetModal.tsx`
    - Controlled modal with fields: Name (required, max 255), Category (required dropdown populated from asset_categories), Serial Number (optional), Condition (optional), Location (optional)
    - No Tag field — tags are auto-generated by the database
    - On submit: call `assetService.createAsset()`, emit `onSuccess` callback with new asset, close modal
    - On `DuplicateSerialError`: show inline error "Serial number already exists", keep modal open
    - On other errors: show inline generic error, keep modal open
    - Props: `{ isOpen: boolean; onClose: () => void; onSuccess: (asset: Asset) => void; categories: AssetCategory[] }`
    - _Requirements: 10.4, 10.5, 10.6, 10.7_

  - [ ]* 6.2 Write unit tests for `RegisterAssetModal.tsx`
    - Render modal; assert no input with name/id/label containing "tag" exists in the DOM
    - Submit valid form; assert `assetService.createAsset` called with correct payload
    - Simulate `DuplicateSerialError`; assert inline error "Serial number already exists" shown, modal stays open
    - _Requirements: 10.4, 10.5, 10.7_

  - [ ]* 6.3 Write property test — P9: modal never contains a Tag field (fast-check)
    - **Property 9: Register Asset modal never contains a Tag field**
    - Generate arbitrary valid modal render states (open/closed, pre-filled fields, any role)
    - Assert no element with name, id, or label text containing "tag" (case-insensitive) is present in the DOM
    - Tag comment: `// Feature: assetflow-stage2, Property 9`
    - **Validates: Requirements 10.5**

- [ ] 7. Build the AllocationHistory component
  - [ ] 7.1 Create `src/components/AllocationHistory.tsx`
    - Props: `{ assetId: string; currentUserRole: UserRole }`
    - On mount: call `allocationService.getAllocationsForAsset(assetId)` and `allocationService.getPendingTransferForAsset(assetId, ...)` in parallel and store results
    - Render chronological timeline with: date range (allocated date → returned date or "Current"), assigned-to name, assigned-by name, return condition
    - Active allocations (returned_at IS NULL) must be visually highlighted (bold text or colored background)
    - When list is empty: render "No previous allocations"
    - Order: most recent first (service already returns DESC)
    - IF a Pending transfer request exists AND `currentUserRole` is `'Admin'` or `'Asset Manager'`: render inline **Approve** and **Reject** buttons for that request; on Approve call `allocationService.approveTransferRequest()`, on Reject call `allocationService.rejectTransferRequest()`; refresh component state on completion
    - IF `currentUserRole` is `'Employee'` or `'Department Head'`: do NOT render Approve/Reject buttons even if a Pending transfer request exists
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 19_

  - [ ]* 7.2 Write unit tests for `AllocationHistory.tsx`
    - Render with empty array; assert "No previous allocations" text
    - Render with N allocations; assert N timeline entries rendered
    - Assert active allocation (returned_at null) has visual distinction class/style
    - Render with Pending transfer request + role 'Asset Manager'; assert Approve and Reject buttons are present
    - Render with Pending transfer request + role 'Employee'; assert Approve and Reject buttons are NOT present
    - Render with no Pending transfer request + role 'Admin'; assert Approve and Reject buttons are NOT present
    - _Requirements: 15.4, 15.5, 15.6_

  - [ ]* 7.3 Write property test — P14: history completeness, order, and inline action visibility (fast-check)
    - **Property 14: Allocation history is complete and correctly ordered**
    - Generate N ∈ [0, 10] allocation records with varying returned_at values; generate a UserRole from the 4-value enum; optionally generate a Pending transfer request
    - Assert component renders exactly N entries, sorted by created_at DESC, with active allocation visually distinguished
    - Assert Approve/Reject buttons present iff (Pending transfer request exists AND role ∈ {'Admin', 'Asset Manager'})
    - Tag comment: `// Feature: assetflow-stage2, Property 14`
    - **Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.6**

- [ ] 8. Build Screen 4 — Asset Directory page
  - [ ] 8.1 Create `src/pages/AssetDirectory.tsx`
    - On mount: call `assetService.listAssets()` and `authService.getCurrentUserRole()` in parallel
    - Render data grid with columns: Tag, Name, Category, Status, Serial Number, Location, Created Date
    - Render filter bar: text input (searches Tag/Name/Serial, case-insensitive), Category dropdown, Status dropdown
    - Show "Register New Asset" button only when `currentUserRole === 'Admin' || currentUserRole === 'Asset Manager'`
    - When button is clicked: open `RegisterAssetModal`; on success: append new asset to local state without full refetch
    - When all assets list is empty: show "No assets registered yet. Click 'Register New Asset' to get started."
    - Apply all active filters simultaneously to the local asset list (client-side filtering)
    - _Requirements: 10.1, 10.2, 10.3, 10.6, 11.1, 11.2, 11.3, 11.4, 11.5_

  - [ ]* 8.2 Write property test — P10: Register button visibility is role-gated (fast-check)
    - **Property 10: Register button visibility is role-gated**
    - For each of the 4 UserRole values, render AssetDirectory with that role mocked
    - Assert button is present iff role ∈ {'Admin', 'Asset Manager'}; absent for 'Employee' and 'Department Head'
    - Tag comment: `// Feature: assetflow-stage2, Property 10`
    - **Validates: Requirements 10.3**

  - [ ]* 8.3 Write property test — P11: filter correctness (fast-check)
    - **Property 11: Asset directory filters narrow the result set correctly**
    - Generate arbitrary asset lists and filter combinations (text, category, status)
    - Assert filtered result = { a ∈ fullList : satisfies all active predicates } — no false positives, no false negatives
    - Tag comment: `// Feature: assetflow-stage2, Property 11`
    - **Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5**

- [ ] 9. Build Screen 5 — Allocation & Transfer page
  - [ ] 9.1 Create `src/pages/AllocationTransfer.tsx`
    - Typeahead search field: debounce 300ms; fire `assetService.searchAssets()` after 2+ chars; cancel in-flight requests via AbortController signal
    - Display suggestions showing Tag + Name; on selection load full asset details via `assetService.searchAssets()` + `allocationService.getActiveAllocation()`
    - When no asset selected: show "Please select an asset to view allocation options"
    - When asset selected: show asset info panel (Tag, Name, Category, Status, Location, Serial Number)
    - When `asset.status === 'Available'`: render Allocate Asset form (Assign To dropdown of active profiles, Expected Return Date optional date picker, Submit button); hide transfer form
    - When `asset.status === 'Allocated'`: render red warning banner "Asset currently allocated to [Current Holder Name]" + Request Transfer form (Reason textarea max 1000 chars, Submit button); hide allocation form
    - On allocation submit: call `allocationService.createAllocation()`; on success show "Asset {tag} allocated to {employee_name}"; on `AllocationConflictError` show error and transition to transfer form
    - On transfer submit: call `allocationService.getPendingTransferForAsset()` first; if pending exists show "You already have a pending request for this asset"; otherwise call `allocationService.createTransferRequest()` and show success message
    - Render `AllocationHistory` component below the main interaction area for any selected asset
    - _Requirements: 12, 13, 14, 15_

  - [ ]* 9.2 Write property test — P12: typeahead returns matching assets (fast-check)
    - **Property 12: Typeahead returns assets matching query in tag or name**
    - Generate arbitrary asset lists and 2+ character query strings
    - Assert result contains only assets where tag or name contains query (case-insensitive), and contains every such asset — no extras, no omissions
    - Tag comment: `// Feature: assetflow-stage2, Property 12`
    - **Validates: Requirements 12.1, 12.2**

  - [ ]* 9.3 Write property test — P13: Screen 5 renders correct form by asset status (fast-check)
    - **Property 13: Screen 5 renders the correct form based on asset status**
    - For any selected asset, assert: status 'Available' → allocation form present, transfer form absent; status 'Allocated' → red warning + transfer form present, allocation form absent
    - Tag comment: `// Feature: assetflow-stage2, Property 13`
    - **Validates: Requirements 13.1, 14.1, 14.2**

- [ ] 10. Wire routes and navigation into App.tsx
  - [ ] 10.1 Add Stage 2 routes to `src/App.tsx`
    - Import `AssetDirectory` from `./pages/AssetDirectory`
    - Import `AllocationTransfer` from `./pages/AllocationTransfer`
    - Add `<Route path="/assets" element={<AssetDirectory />} />` — auth required, all roles
    - Add `<Route path="/allocations" element={<AllocationTransfer />} />` — auth required, all roles
    - Add navigation links to these pages from the Dashboard so authenticated users can reach them
    - _Requirements: 10.1, 12.1_

  - [ ]* 10.2 Write unit tests for route wiring
    - Assert `/assets` renders `AssetDirectory` (not a redirect)
    - Assert `/allocations` renders `AllocationTransfer` (not a redirect)
    - _Requirements: 10.1, 12.1_

- [ ] 11. Install testing dependencies and configure Vitest
  - Add `vitest`, `@vitest/ui`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, and `fast-check` as devDependencies
  - Add `vitest.config.ts` (or extend `vite.config.ts`) with `environment: 'jsdom'` and `globals: true`
  - Add `setupTests.ts` importing `@testing-library/jest-dom`
  - Update `package.json` scripts: add `"test": "vitest --run"` and `"test:watch": "vitest"`
  - _Requirements: none (infrastructure task)_

- [ ] 12. Final checkpoint — Ensure all tests pass
  - Run `npm run test` and confirm all unit and property tests pass
  - Paste `supabase/migration_stage2_assets_allocation.sql` into Supabase Dashboard → SQL Editor and confirm it runs without errors
  - Verify `only_one_active_allocation` index and `sync_asset_status` trigger are visible in Supabase Dashboard
  - Ensure all tests pass, ask the user if questions arise.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP delivery
- Each task references specific requirements for traceability
- DB-backed property tests (P1–P8, P15) require a Supabase test project or local Supabase instance; UI property tests (P9–P14) run in jsdom with mocked services
- The partial unique index `only_one_active_allocation` is the canonical double-allocation guard — trust the DB, not the application layer
- `is_asset_manager()` follows the exact same `SECURITY DEFINER` pattern as the Stage 1 `is_admin()` to avoid RLS recursion
- Migration file is additive only; Stage 1 objects (`schema.sql`) are never touched
- `AllocationConflictError` and `DuplicateSerialError` should carry the PostgreSQL error code in their message to aid debugging

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "2.2", "11"] },
    { "id": 2, "tasks": ["3.1", "4.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "3.4", "4.2", "4.3", "4.4", "4.5", "4.6", "4.7", "4.8", "4.9"] },
    { "id": 4, "tasks": ["6.1", "7.1"] },
    { "id": 5, "tasks": ["6.2", "6.3", "7.2", "7.3"] },
    { "id": 6, "tasks": ["8.1"] },
    { "id": 7, "tasks": ["8.2", "8.3", "9.1"] },
    { "id": 8, "tasks": ["9.2", "9.3", "10.1"] },
    { "id": 9, "tasks": ["10.2"] }
  ]
}
```
