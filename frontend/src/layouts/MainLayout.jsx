import React from 'react';
import Navbar from '../components/Navbar';
import Sidebar from '../components/Sidebar';
import Footer from '../components/Footer';

export default function MainLayout({ children }) {
  return (
    <div className="app-shell" style={{ minHeight: '100vh', background: '#f8fafc' }}>
      <Navbar />
      <div className="main-layout-container">
        <div className="main-layout">
          <Sidebar />
          <main className="main-content">{children}</main>
        </div>
      </div>
      <Footer />
    </div>
  );
}
