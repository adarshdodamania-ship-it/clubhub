// src/components/Navbar.js
import React from 'react';

export default function Navbar() {
  const email = localStorage.getItem('user_email') || localStorage.getItem('email') || '';

  function handleSignOut() {
    localStorage.removeItem('token');
    localStorage.removeItem('user_email');
    localStorage.removeItem('email');
    // reload to show signed-out state
    window.location.href = '/';
  }

  function openProfile() {
    // profile.html should be in public/ so it's served at /profile.html
    window.location.href = '/profile.html';
  }

  return (
    <header style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '12px 20px',
      background: '#ffffff',
      borderBottom: '1px solid #eee'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 8,
          background: 'linear-gradient(90deg,#feda75,#d62976)',
          display: 'inline-block'
        }} />
        <strong>Club Hub</strong>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={openProfile}
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid #ddd',
            background: '#fff',
            cursor: 'pointer'
          }}
        >
          Profile
        </button>

        <div style={{
          padding: '6px 10px',
          borderRadius: 20,
          background: '#fff',
          border: '1px solid #eee',
          fontSize: 14
        }}>
          {email || 'Not signed in'}
        </div>

        <button
          onClick={handleSignOut}
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            background: '#111',
            color: '#fff',
            border: 0,
            cursor: 'pointer'
          }}
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
