PRD: AssetFlow - Stage 2 (Asset Core & Allocation Engine)
=========================================================

1\. Objective
-------------

Build the core asset state machine and allocation engine. By the end of this stage, Asset Managers must be able to register physical assets into the system, allocate them to specific employees/departments, and be strictly blocked by the database from double-allocating an asset.

2\. Database Architecture (Supabase Schema)
-------------------------------------------

This stage introduces the assets themselves and the transactional tables that track their movement.

### Sequence: asset\_tag\_seq

A standard PostgreSQL sequence starting at 1, used to auto-generate human-readable asset tags.

### Table: assets

The master inventory list.

*   **id** (UUID, Primary Key): Auto-generated.
    
*   **tag** (Text, Unique, NOT NULL): Auto-generated using the sequence (e.g., AF-0001). Default value: 'AF-' || LPAD(nextval('asset\_tag\_seq')::TEXT, 4, '0').
    
*   **name** (Text, NOT NULL): e.g., "Dell XPS 15".
    
*   **category\_id** (UUID, Foreign Key, NOT NULL): References asset\_categories.id (From Stage 1).
    
*   **serial\_number** (Text, Nullable, Unique): Manufacturer's serial number.
    
*   **status** (Enum, NOT NULL): Allowed values: 'Available', 'Allocated', 'Reserved', 'Under Maintenance', 'Lost', 'Retired', 'Disposed'. Default: 'Available'.
    
*   **condition** (Text, Nullable): e.g., "New", "Good", "Needs Repair".
    
*   **location** (Text, Nullable): e.g., "HQ Floor 2".
    
*   **is\_bookable** (Boolean, NOT NULL): Flag for Screen 6 later. Default: false.
    
*   **created\_at** (Timestamp, NOT NULL).
    

### Table: allocations

The historical and active ledger of who holds what.

*   **id** (UUID, Primary Key): Auto-generated.
    
*   **asset\_id** (UUID, Foreign Key, NOT NULL): References assets.id.
    
*   **assigned\_to** (UUID, Foreign Key, NOT NULL): References profiles.id.
    
*   **assigned\_by** (UUID, Foreign Key, NOT NULL): References profiles.id (The manager who made the allocation).
    
*   **expected\_return\_date** (Date, Nullable).
    
*   **returned\_at** (Timestamp, Nullable): If NULL, this allocation is currently active.
    
*   **return\_condition** (Text, Nullable): Notes captured upon return.
    

### Table: transfer\_requests

Pending requests for assets that are already allocated.

*   **id** (UUID, Primary Key): Auto-generated.
    
*   **asset\_id** (UUID, Foreign Key, NOT NULL): References assets.id.
    
*   **requested\_by** (UUID, Foreign Key, NOT NULL): References profiles.id.
    
*   **current\_holder** (UUID, Foreign Key, NOT NULL): References profiles.id.
    
*   **reason** (Text, NOT NULL).
    
*   **status** (Enum, NOT NULL): 'Pending', 'Approved', 'Rejected'. Default: 'Pending'.
    

3\. Data Integrity & The "Conflict Rule"
----------------------------------------

This is the most critical technical requirement of Stage 2. We will enforce the double-allocation block at the database level so the frontend cannot possibly mess it up.

*   **The Partial Unique Index:** We will create a partial index on the allocations table:CREATE UNIQUE INDEX only\_one\_active\_allocation ON allocations (asset\_id) WHERE returned\_at IS NULL;_Why:_ This makes it mathematically impossible in PostgreSQL to have two active allocations for the same asset. If a manager tries to allocate an already allocated asset, the database will throw a constraint error.
    
*   **Asset Status Sync (Trigger):** Create a PostgreSQL trigger on the allocations table.
    
    *   When a new allocation is inserted (where returned\_at is NULL), update the corresponding assets.status to 'Allocated'.
        
    *   When an allocation is updated and returned\_at is populated, update the assets.status back to 'Available'.
        

4\. Security & Access Control (RLS)
-----------------------------------

*   **Assets Table:**
    
    *   _Read:_ All authenticated users.
        
    *   _Insert/Update/Delete:_ Only role = 'Admin' OR role = 'Asset Manager'.
        
*   **Allocations Table:**
    
    *   _Read:_ All authenticated users.
        
    *   _Insert/Update:_ Only role = 'Admin', role = 'Asset Manager', or role = 'Department Head'.
        
*   **Transfer Requests Table:**
    
    *   _Read:_ All authenticated users.
        
    *   _Insert:_ Any authenticated user (anyone can request an asset).
        
    *   _Update:_ Only the Asset Manager or the Department Head of the department holding the asset.
        

5\. User Interface Requirements
-------------------------------

### Screen 4: Asset Registration & Directory

**Purpose:** Manage the physical inventory.

*   **Data Grid:** Display assets showing Tag, Name, Category (mapped from category\_id), Status, and Location.
    
*   **Filters:** A text input to search by Tag/Serial, and dropdowns to filter by Category and Status.
    
*   **"Register Asset" Modal:** \* Accessible only to Admins/Asset Managers.
    
    *   Form fields: Name (text), Category (Select dropdown fetching from asset\_categories), Serial Number (text), Condition (text), Location (text).
        
    *   _Note:_ The Tag is intentionally missing from the form because the database generates it automatically on submit.
        

### Screen 5: Allocation & Transfer

**Purpose:** Assign assets and handle conflicts.

*   **Asset Selection:** A typeahead/search field to select an asset by its Tag or Name.
    
*   **Dynamic UI Rendering based on Asset Status:**
    
    *   **Scenario A (Asset is 'Available'):** Render the "Allocate Asset" form. Requires selecting an Employee (from profiles), an optional Expected Return Date, and a "Submit Allocation" button.
        
    *   **Scenario B (Asset is 'Allocated'):** Hide the allocation form. Display a prominent red warning banner: _"Already allocated to \[Employee Name\]"_. Below the banner, render the "Transfer Request" form, requiring a Reason (textarea) and a "Submit Request" button.
        
*   **Allocation History:** Below the main interactive area, display a read-only timeline (querying the allocations table) showing the selected asset's past and present assignments.
    

6\. Definition of Done (Stage 2 Acceptance Criteria)
----------------------------------------------------

1.  I can register a new asset (e.g., "MacBook Pro") on Screen 4, and it appears in the grid with an auto-generated tag (e.g., AF-0001) and a status of "Available".
    
2.  On Screen 5, I can select AF-0001 and allocate it to Employee A. The asset's status automatically updates to "Allocated".
    
3.  If I select AF-0001 again on Screen 5, the system blocks direct allocation, reveals who currently holds it, and forces me to use the Transfer Request form.
    
4.  Attempting to force an allocation via API for an already allocated asset results in a PostgreSQL constraint violation, protecting the database.