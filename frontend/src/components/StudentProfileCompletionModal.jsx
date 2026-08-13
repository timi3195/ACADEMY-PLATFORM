import React, { useState } from 'react';
import { useAuth } from '../utils/auth';
import NotificationBanner from './NotificationBanner';

export default function StudentProfileCompletionModal({ isOpen, onClose, onSuccess, materialId }) {
  const { user, updateProfile } = useAuth();
  const [formData, setFormData] = useState({
    matricNumber: user?.matricNumber || '',
    yearOfStudy: user?.yearOfStudy || '',
    department: user?.department?._id || user?.department || ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [departments, setDepartments] = useState([]);

  // Load departments on mount
  React.useEffect(() => {
    if (isOpen) {
      loadDepartments();
    }
  }, [isOpen]);

  const loadDepartments = async () => {
    try {
      const response = await fetch('/api/departments');
      const result = await response.json();
      if (result.success && Array.isArray(result.departments)) {
        setDepartments(result.departments);
      }
    } catch (err) {
      console.error('Failed to load departments:', err);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Validation
    if (!formData.matricNumber || !String(formData.matricNumber).trim()) {
      setError('Matric number is required');
      return;
    }
    if (!formData.yearOfStudy) {
      setError('Academic level is required');
      return;
    }
    if (!formData.department) {
      setError('Department is required');
      return;
    }

    try {
      setLoading(true);
      await updateProfile(formData);
      setError('');
      if (onSuccess) {
        onSuccess();
      }
      onClose();
    } catch (err) {
      setError(err.message || 'Unable to update profile');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '20px'
    }}>
      <div style={{
        background: '#fff',
        borderRadius: '12px',
        padding: '24px',
        maxWidth: '500px',
        width: '100%',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
      }}>
        <h2 style={{ marginTop: 0, marginBottom: '8px' }}>Complete Your Student Profile</h2>
        <p style={{ color: '#64748b', marginBottom: '16px' }}>
          Before purchasing this material, please provide your student information.
        </p>

        {error && <NotificationBanner type="error" message={error} onClose={() => setError('')} />}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, fontSize: '14px' }}>Matric Number</label>
            <input
              type="text"
              name="matricNumber"
              value={formData.matricNumber}
              onChange={handleChange}
              placeholder="e.g., ND19/001"
              required
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '14px',
                boxSizing: 'border-box'
              }}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, fontSize: '14px' }}>Academic Level</label>
            <select
              name="yearOfStudy"
              value={formData.yearOfStudy}
              onChange={handleChange}
              required
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '14px',
                fontFamily: 'inherit'
              }}
            >
              <option value="">-- Select your level --</option>
              <option value="ND1">ND1</option>
              <option value="ND2">ND2</option>
              <option value="HND1">HND1</option>
              <option value="HND2">HND2</option>
            </select>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, fontSize: '14px' }}>Department</label>
            <select
              name="department"
              value={formData.department}
              onChange={handleChange}
              required
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '14px',
                fontFamily: 'inherit'
              }}
            >
              <option value="">-- Select your department --</option>
              {departments.map((dept) => (
                <option key={dept._id} value={dept._id}>
                  {dept.name}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              style={{
                flex: 1,
                padding: '10px',
                background: '#f3f4f6',
                color: '#374151',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: '600',
                cursor: loading ? 'default' : 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{
                flex: 1,
                padding: '10px',
                background: loading ? '#9ca3af' : '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: '600',
                cursor: loading ? 'default' : 'pointer'
              }}
            >
              {loading ? 'Saving...' : 'Complete & Continue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
