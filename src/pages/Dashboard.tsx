// Placeholder Dashboard screen for non-Admin roles.
// Requirements: 10.4

import { Link } from 'react-router-dom'

export default function Dashboard() {
  return (
    <main style={{ padding: '2rem', textAlign: 'center' }}>
      <h1>Dashboard</h1>
      <p>Welcome! Your dashboard will appear here.</p>
      <nav style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem', justifyContent: 'center' }}>
        <Link to="/assets">Asset Directory</Link>
        <Link to="/allocations">Allocation &amp; Transfer</Link>
        <Link to="/bookings">Resource Booking</Link>
        <Link to="/maintenance">Maintenance Board</Link>
      </nav>
    </main>
  )
}
