import React from 'react';
import Navbar from '../components/Navbar';
import Sidebar from '../components/Sidebar';

export default function MainLayout({ children }) {
  return (
    <div className="app-shell">
      <div className="dashboard-shell">
        <Sidebar />
        <div className="dashboard-main-panel">
          <Navbar />
          <main className="main-content-area">{children}</main>
        </div>
      </div>
    </div>
  );
}
