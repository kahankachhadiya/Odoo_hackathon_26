PRD: AssetFlow - Stage 3 (Resource Booking & Maintenance Workflows)
===================================================================

1\. Objective
-------------

Implement the specialized operational workflows for AssetFlow. This stage delivers Screen 6 (Resource Booking) with strict, database-level time-slot overlap prevention, and Screen 7 (Maintenance Management) using a simplified, click-to-move Kanban board layout.

2\. Database Architecture (Supabase Schema)
-------------------------------------------

This stage introduces tables for time-based scheduling and repair ticketing, linking directly to the assets and profiles tables established in Stages 1 and 2.

### Table: bookings

Tracks time-slots for shared resources (e.g., conference rooms, projectors).

*   **id** (UUID, Primary Key): Auto-generated.
    
*   **asset\_id** (UUID, Foreign Key, NOT NULL): References assets.id ON DELETE CASCADE.
    
*   **booked\_by** (UUID, Foreign Key, NOT NULL): References profiles.id ON DELETE CASCADE.
    
*   **title** (Text, NOT NULL): e.g., "Q3 Planning Meeting".
    
*   **start\_time** (Timestamptz, NOT NULL).
    
*   **end\_time** (Timestamptz, NOT NULL).
    
*   **status** (Enum, NOT NULL): Allowed values: 'Upcoming', 'Ongoing', 'Completed', 'Cancelled'. Default: 'Upcoming'.
    
*   **Constraint:** start\_time must be strictly less than end\_time.
    

### Table: maintenance\_requests

Tickets for broken or malfunctioning assets.

*   **id** (UUID, Primary Key): Auto-generated.
    
*   **asset\_id** (UUID, Foreign Key, NOT NULL): References assets.id ON DELETE CASCADE.
    
*   **requested\_by** (UUID, Foreign Key, NOT NULL): References profiles.id ON DELETE CASCADE.
    
*   **issue\_description** (Text, NOT NULL).
    
*   **priority** (Enum, NOT NULL): Allowed values: 'Low', 'Medium', 'High'. Default: 'Medium'.
    
*   **status** (Enum, NOT NULL): Allowed values: 'Pending', 'Approved', 'In Progress', 'Resolved', 'Rejected'. Default: 'Pending'.
    
*   **technician\_name** (Text, Nullable): Simple text field for the assigned repair person (avoids complex external table joins for the hackathon).
    
*   **created\_at** (Timestamptz, NOT NULL): Default now().
    

3\. Data Integrity & Business Logic
-----------------------------------

### The Overlap Validation Rule (Bookings)

To prevent the frontend from double-booking a room due to race conditions, overlap logic must be enforced in PostgreSQL.

*   **Trigger:** prevent\_booking\_overlap()
    
*   **Execution:** Runs BEFORE INSERT OR UPDATE on the bookings table.
    
*   **Logic:** The database must query for any existing row with the same asset\_id where status != 'Cancelled' AND (NEW.start\_time < existing.end\_time AND NEW.end\_time > existing.start\_time).
    
*   **Result:** If a match is found, the database raises an exception ('Booking time slot overlaps with an existing reservation'), aborting the transaction.
    

### The Maintenance State Sync (Trigger)

*   **Trigger:** sync\_maintenance\_status()
    
*   **Execution:** Runs AFTER UPDATE on the maintenance\_requests table.
    
*   **Logic:**
    
    *   If maintenance\_requests.status changes to 'Approved', automatically update the parent assets.status to 'Under Maintenance'.
        
    *   If maintenance\_requests.status changes to 'Resolved', automatically update the parent assets.status back to 'Available'.
        

4\. Security & Access Control (RLS)
-----------------------------------

*   **Bookings Table:**
    
    *   _Read:_ All authenticated users.
        
    *   _Insert:_ Any authenticated user, provided the target asset has is\_bookable = true. (Enforce via DB constraint or RLS condition).
        
    *   _Update (Cancel):_ Only the user who created the booking (booked\_by = auth.uid()), OR users where is\_admin() is true.
        
*   **Maintenance Requests Table:**
    
    *   _Read:_ All authenticated users.
        
    *   _Insert:_ Any authenticated user can raise a ticket.
        
    *   _Update:_ Only users with the 'Admin' or 'Asset Manager' role can change the status or assign a technician\_name. (Use the is\_asset\_manager() helper from Stage 2).
        

5\. User Interface Requirements
-------------------------------

### Screen 6: Resource Booking

**Purpose:** Allow employees to reserve shared assets (rooms, vehicles) without time conflicts.

*   **Resource Selector:** A dropdown or typeahead limited exclusively to assets where is\_bookable = true.
    
*   **Booking Form:**
    
    *   Fields: Title (text), Date (date picker), Start Time (time picker), End Time (time picker).
        
    *   Submit Button: "Confirm Booking".
        
*   **Error Handling:** If the Supabase request fails due to the overlap trigger, display the error inline: "This time slot is already booked."
    
*   **Schedule View:** Below the form, display a daily timeline or list view showing today's existing bookings for the selected asset so the user can easily see available gaps.
    

### Screen 7: Maintenance Management

**Purpose:** Route repairs through an approval workflow.

*   **The UI Layout (Simplified Kanban):** To save 8-hour sprint time, do _not_ implement drag-and-drop libraries (like dnd-kit). Build a CSS Grid with 4 columns: **Pending**, **Approved**, **In Progress**, **Resolved**.
    
*   **Maintenance Cards:** Each request renders as a card in its respective status column. The card displays the Asset Tag, Issue Description, Priority (color-coded), and Requested By.
    
*   **State Transitions (Click-to-Move):**
    
    *   If the current user is an Admin/Asset Manager, the cards contain action buttons to push them to the next state.
        
    *   _Pending Column:_ Cards have "Approve" and "Reject" buttons.
        
    *   _Approved Column:_ Cards have a "Start Work" button (moves to In Progress) and an optional text input to add a technician\_name.
        
    *   _In Progress Column:_ Cards have a "Resolve" button.
        
*   **"Raise Request" Modal:** A floating action button (FAB) or top-level button allowing any user to submit a new maintenance request (Select Asset, Describe Issue, Select Priority).
    

6\. Definition of Done (Stage 3 Acceptance Criteria)
----------------------------------------------------

1.  I can navigate to Screen 6, select a bookable asset, and successfully book it from 9:00 AM to 10:00 AM.
    
2.  If I (or another user) attempt to book the same asset from 9:30 AM to 10:30 AM, the database rejects it, and the UI displays the overlap error.
    
3.  I can book the same asset from 10:00 AM to 11:00 AM without conflict (adjacent times are permitted).
    
4.  I can navigate to Screen 7 and raise a new maintenance request, which immediately appears in the "Pending" column.
    
5.  As an Asset Manager, I can click "Approve" on that request card. The card moves to the "Approved" column, and the corresponding asset's master status is automatically updated to "Under Maintenance" in the database.