import { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import './Layout.css';
import { useRightSidebarState } from '../context/RightSidebarContext';
import FeeReminderBanner from './FeeReminderBanner';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/import', label: 'Import' },
  { to: '/transactions', label: 'Transactions' },
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
          <div className="sidebar-title">Sweeper</div>
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
