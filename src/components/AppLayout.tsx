import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import './AppLayout.css'; // We'll create this next

const AppLayout = () => {
  const navigate = useNavigate();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/');
  };

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <h2>AssetFlow</h2>
        </div>
        
        <nav className="sidebar-nav">
          <NavLink to="/dashboard" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
            Dashboard
          </NavLink>
          <NavLink to="/admin/setup" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
            Organization setup
          </NavLink>
          <NavLink to="/assets" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
            Assets
          </NavLink>
          <NavLink to="/allocations" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
            Allocation & Transfer
          </NavLink>
          <NavLink to="/bookings" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
            Resource Booking
          </NavLink>
          <NavLink to="/maintenance" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
            Maintenance
          </NavLink>
          
          {/* Mock links based on mockup that don't have routes yet */}
          <div className="nav-item disabled">Audit</div>
          <div className="nav-item disabled">Reports</div>
          <div className="nav-item disabled">Notifications</div>
        </nav>

        <div className="sidebar-footer">
          <button onClick={handleLogout} className="logout-btn">
            Logout
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        <div className="content-container">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default AppLayout;
