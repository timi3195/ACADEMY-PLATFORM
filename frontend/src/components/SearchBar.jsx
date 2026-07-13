import React from 'react';

export default function SearchBar({ value, onChange, placeholder = 'Search materials' }) {
  return (
    <div style={{ width: '100%' }}>
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        style={{ marginTop: 0 }}
      />
    </div>
  );
}
