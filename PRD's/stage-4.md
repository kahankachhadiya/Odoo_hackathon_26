PRD: AssetFlow - Stage 4 (Dashboards & Telemetry)
=================================================

1\. Objective
-------------

Aggregate system-wide data into actionable insights and centralized activity feeds. By the end of this stage, the application will provide a real-time snapshot of operations (Screen 2), a high-level analytics view (Screen 9), and an auditable trail of system events (Screen 10).

2\. Database Architecture (Supabase Schema)
-------------------------------------------

To avoid having the frontend query and merge five different tables to create an activity feed, we will introduce a single, unified log table powered by database triggers.

### Table: activity\_logs

A centralized, append-only ledger of major system events.

*   **id** (UUID, Primary Key): Auto-generated.
    
*   **event\_type** (Enum, NOT NULL): Allowed values: 'Asset Registered', 'Allocation', 'Transfer', 'Booking', 'Maintenance', 'Audit'.
    
*   **message** (Text, NOT NULL): Human-readable string (e.g., _"Laptop AF-0014 allocated to Priya Shah"_).
    
*   **actor\_id** (UUID, Foreign Key, Nullable): References profiles.id ON DELETE SET NULL.
    
*   **reference\_id** (UUID, Nullable): The ID of the affected record (asset, booking, etc.) for potential deep-linking.
    
*   **created\_at** (Timestamptz, NOT NULL): Default now().
    

### The Universal Telemetry Triggers

Instead of the frontend making dual API calls, PostgreSQL will automatically write to activity\_logs when major actions occur.

*   **Trigger 1:** log\_new\_allocation() - AFTER INSERT on allocations. Generates: _"Asset \[Tag\] allocated by \[Admin\] to \[Employee\]"_.
    
*   **Trigger 2:** log\_maintenance\_update() - AFTER UPDATE on maintenance\_requests (specifically when status changes to Approved/Resolved). Generates: _"Maintenance request for \[Tag\] \[Status\]"_.
    
*   **Trigger 3:** log\_booking\_created() - AFTER INSERT on bookings. Generates: _"Resource \[Title\] booked for \[Date\]"_.
    

3\. Security & Access Control (RLS)
-----------------------------------

Telemetry data must be strictly governed by the roles established in Stage 1.

*   **Activity Logs Table:**
    
    *   _Read:_ \* If role = 'Admin' or 'Asset Manager', they can read ALL logs.
        
        *   If role = 'Department Head', they can read logs where the actor\_id belongs to a user in their department\_id.
            
        *   If role = 'Employee', they can only read logs where actor\_id = auth.uid().
            
    *   _Insert:_ Internal database triggers ONLY. (RLS policy blocks all direct client-side INSERTS).
        
    *   _Update/Delete:_ Strictly denied for all roles (immutable ledger).
        

4\. User Interface Requirements
-------------------------------

### Screen 2: Dashboard / Home Screen

**Purpose:** Give users an immediate operational snapshot upon login.

*   **KPI Cards:** Execute concurrent supabase.from().select('\*', { count: 'exact', head: true }) queries to generate real-time metrics for:
    
    *   Total Assets Available (from assets)
        
    *   Total Assets Allocated (from assets)
        
    *   Active Bookings Today (from bookings)
        
    *   Pending Maintenance (from maintenance\_requests)
        
*   **The Overdue Alert Banner:** Query allocations where returned\_at IS NULL AND expected\_return\_date < current\_date. If count > 0, display a prominent red banner: \[Count\] assets overdue for return - flagged for follow-up.
    
*   **Recent Activity Feed:** Render a simplified list of the 5 most recent entries from the activity\_logs table.
    

### Screen 9: Reports & Analytics

**Purpose:** Managerial insight. (Hackathon Time-Saver Mode Activated).

*   **Visual Charts (MOCKED DATA):** \* _Instruction to execution agent:_ Do NOT write complex SQL grouping queries. Use a lightweight charting library (e.g., Recharts) to render a "Utilization by Department" Bar Chart and a "Maintenance Frequency" Line Chart using hardcoded, static JSON arrays to guarantee they look perfect for the demo.
    
*   **Actionable Lists (REAL DATA):**
    
    *   _Idle Assets:_ Query assets where status = 'Available' (Limit 5) to show items sitting in storage.
        
    *   _Due for Maintenance/Retirement:_ Query assets where created\_at is older than a specific date threshold (e.g., 3 years old) or condition = 'Needs Repair'.
        
*   **Export Button:** A button that generates a simple CSV of the current inventory (query assets and trigger a browser file download).
    

### Screen 10: Activity Logs & Notifications

**Purpose:** The full, paginated audit trail.

*   **Log Feed:** A detailed data grid or list view mapping the activity\_logs table, ordered by created\_at descending.
    
*   **Filters:** Top-level pill buttons to filter the feed by event\_type (e.g., "All", "Alerts", "Approvals", "Bookings").
    

5\. Definition of Done (Stage 4 Acceptance Criteria)
----------------------------------------------------

1.  Upon completing a login flow (from Stage 1), I am routed to Screen 2, and the KPI cards accurately reflect the counts of the data currently in my Supabase database.
    
2.  If I allocate an asset with an expected\_return\_date of yesterday (testing Stage 2 data), the Dashboard immediately surfaces a red Overdue Alert banner.
    
3.  When I perform an action like booking a room (Stage 3), a database trigger automatically generates a log entry, which immediately appears in the Recent Activity feed on Screen 2 and Screen 10.
    
4.  On Screen 9, I can view beautifully rendered (albeit mocked) charts, alongside real data lists of available/idle assets.
    
5.  On Screen 10, I can view a comprehensive list of all system actions, restricted by my RLS viewing permissions (Admins see everything; Employees see only their actions).