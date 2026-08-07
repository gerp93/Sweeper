import { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import './Layout.css';
import { useRightSidebarState } from '../context/RightSidebarContext';
import FeeReminderBanner from './FeeReminderBanner';
import logo from '../assets/logo.png';

const NAV_ITEMS = [
  { to: '/', label: 'Transactions', end: true },
  { to: '/import', label: 'Import' },
  { to: '/reconcile', label: 'Reconcile' },
  { to: '/accounts', label: 'Accounts' },
  { to: '/settings', label: 'Settings' },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { content: rightSidebarContent, collapsed: rightSidebarCollapsed } = useRightSidebarState();

  return (
    <div className="app-root">
      <FeeReminderBanner />
      <div className="app-shell">
        <nav className="sidebar">
          <div className="sidebar-title">
            <img src={logo} alt="" className="sidebar-logo" />
            Sweeper
          </div>
          <ul>
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} end={item.end} className={({ isActive }) => (isActive ? 'active' : '')}>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <main className="main-content">{children}</main>
        {rightSidebarContent && (
          <nav className={`sidebar sidebar-right${rightSidebarCollapsed ? ' collapsed' : ''}`}>
            {rightSidebarContent}
          </nav>
        )}
      </div>
    </div>
  );
}
