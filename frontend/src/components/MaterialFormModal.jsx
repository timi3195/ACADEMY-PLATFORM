import React, { useEffect, useState } from 'react';
import Modal from './Modal';
import NotificationBanner from './NotificationBanner';
import { buildMaterialPayload } from '../utils/materialForm';

const emptyForm = {
  title: '',
  description: '',
  course: '',
  department: '',
  price: '0',
  visibility: 'public',
  level: 'Other',
  previewPages: '0'
};

export default function MaterialFormModal({ isOpen, onClose, mode = 'create', initialValues = {}, onSubmit, loading, error }) {
  const [form, setForm] = useState(emptyForm);
  const [file, setFile] = useState(null);

  useEffect(() => {
    if (isOpen) {
      setForm({
        ...emptyForm,
        ...initialValues,
        price: initialValues.price ?? '0',
        previewPages: initialValues.previewPages ?? '0',
        visibility: initialValues.visibility || 'public',
        level: initialValues.level || 'Other'
      });
      setFile(null);
    }
  }, [isOpen, initialValues]);

  const changeField = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();

    const payload = buildMaterialPayload(form);
    onSubmit(payload, file);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={mode === 'edit' ? 'Edit material' : 'Upload material'}>
      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '12px' }}>
        {error && <NotificationBanner type="error" message={error} />}

        <label style={{ display: 'grid', gap: '6px' }}>
          <span style={{ fontWeight: 600 }}>Title</span>
          <input name="title" value={form.title} onChange={changeField} required />
        </label>

        <label style={{ display: 'grid', gap: '6px' }}>
          <span style={{ fontWeight: 600 }}>Description</span>
          <textarea name="description" value={form.description} onChange={changeField} rows={4} required />
        </label>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <label style={{ display: 'grid', gap: '6px' }}>
            <span style={{ fontWeight: 600 }}>Course ID</span>
            <input name="course" value={form.course} onChange={changeField} required placeholder="Course ObjectId" />
          </label>

          <label style={{ display: 'grid', gap: '6px' }}>
            <span style={{ fontWeight: 600 }}>Department ID</span>
            <input name="department" value={form.department} onChange={changeField} placeholder="Department ObjectId" />
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <label style={{ display: 'grid', gap: '6px' }}>
            <span style={{ fontWeight: 600 }}>Price</span>
            <input name="price" type="number" min="0" value={form.price} onChange={changeField} />
          </label>

          <label style={{ display: 'grid', gap: '6px' }}>
            <span style={{ fontWeight: 600 }}>Preview pages</span>
            <input name="previewPages" type="number" min="0" value={form.previewPages} onChange={changeField} />
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <label style={{ display: 'grid', gap: '6px' }}>
            <span style={{ fontWeight: 600 }}>Visibility</span>
            <select name="visibility" value={form.visibility} onChange={changeField}>
              <option value="public">Public</option>
              <option value="unlisted">Unlisted</option>
              <option value="private">Private</option>
            </select>
          </label>

          <label style={{ display: 'grid', gap: '6px' }}>
            <span style={{ fontWeight: 600 }}>Level</span>
            <select name="level" value={form.level} onChange={changeField}>
              <option value="ND1">ND1</option>
              <option value="ND2">ND2</option>
              <option value="HND1">HND1</option>
              <option value="HND2">HND2</option>
              <option value="Other">Other</option>
            </select>
          </label>
        </div>

        <label style={{ display: 'grid', gap: '6px' }}>
          <span style={{ fontWeight: 600 }}>File</span>
          <input type="file" accept="application/pdf" onChange={(event) => setFile(event.target.files?.[0] || null)} required={mode !== 'edit'} />
        </label>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={loading}>{loading ? 'Saving...' : mode === 'edit' ? 'Save changes' : 'Upload material'}</button>
        </div>
      </form>
    </Modal>
  );
}
