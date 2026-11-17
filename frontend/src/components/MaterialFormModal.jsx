import React, { useEffect, useState } from 'react';
import Modal from './Modal';
import NotificationBanner from './NotificationBanner';
import ConfirmationDialog from './ConfirmationDialog';
import { buildMaterialPayload } from '../utils/materialForm';

const EMPTY_FORM = {
  title: '',
  description: '',
  course: '',
  materialType: 'Lecture Note',
  category: 'Lecture Notes',
  tags: '',
  language: 'English',
  pageCount: '0',
  previewPages: '0',
  status: 'draft'
};

const validateForm = (form, file, mode) => {
  const errors = [];
  if (!form.course) errors.push('Select an assigned course');
  if (!String(form.title || '').trim()) errors.push('Material title is required');
  if (!String(form.description || '').trim()) errors.push('Description is required');
  if (mode === 'create' && !file) errors.push('A material file is required');
  return errors;
};

export default function MaterialFormModal({
  isOpen,
  onClose,
  mode = 'create',
  initialValues = {},
  courses = [],
  onSubmit,
  loading,
  error
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [file, setFile] = useState(null);
  const [coverImage, setCoverImage] = useState(null);
  const [validationErrors, setValidationErrors] = useState([]);
  const [isDirty, setIsDirty] = useState(false);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setForm({
      ...EMPTY_FORM,
      ...initialValues,
      course: String(initialValues.courseRef?._id || initialValues.courseRef || ''),
      status: initialValues.status || 'draft'
    });
    setFile(null);
    setCoverImage(null);
    setValidationErrors([]);
    setIsDirty(false);
    setConfirmCloseOpen(false);
  }, [initialValues, isOpen]);

  const selectedCourse = courses.find((course) => String(course._id) === String(form.course));
  const changeField = (event) => {
    setForm((previous) => ({ ...previous, [event.target.name]: event.target.value }));
    setIsDirty(true);
  };

  const requestClose = () => {
    if (isDirty) setConfirmCloseOpen(true);
    else onClose?.();
  };

  const submit = async (status) => {
    const errors = validateForm(form, file, mode);
    if (errors.length) {
      setValidationErrors(errors);
      return;
    }
    setValidationErrors([]);
    try {
      await onSubmit(buildMaterialPayload({ ...form, status }), file, coverImage);
      setIsDirty(false);
      onClose?.();
    } catch (submitError) {
      setValidationErrors([submitError?.message || 'Unable to save this course material.']);
    }
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={requestClose} title={mode === 'edit' ? 'Edit course material' : 'Add course material'}>
        <form onSubmit={(event) => { event.preventDefault(); submit('published'); }} style={{ display: 'grid', gap: 14 }}>
          {error && <NotificationBanner type="error" message={error} />}
          {validationErrors.length > 0 && <NotificationBanner type="error" message={validationErrors.join(' • ')} />}
          <label style={{ display: 'grid', gap: 6 }}>
            <span>Assigned course</span>
            <select name="course" value={form.course} onChange={changeField} required>
              <option value="">Select a course</option>
              {courses.map((course) => (
                <option key={course._id} value={course._id}>{course.code} — {course.title}</option>
              ))}
            </select>
          </label>
          {selectedCourse && (
            <p style={{ margin: 0, color: '#64748b' }}>
              {selectedCourse.department?.name || 'Department'} · {selectedCourse.level} · {selectedCourse.semester} semester
            </p>
          )}
          <label style={{ display: 'grid', gap: 6 }}>
            <span>Material title</span>
            <input name="title" value={form.title} onChange={changeField} required maxLength={200} />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span>Description</span>
            <textarea name="description" value={form.description} onChange={changeField} rows={4} required />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span>Material type</span>
              <select name="materialType" value={form.materialType} onChange={changeField}>
                {['Lecture Note', 'Past Question', 'Assignment', 'Lab Manual', 'Textbook', 'Other'].map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span>Page count (optional)</span>
              <input name="pageCount" type="number" min="0" value={form.pageCount} onChange={changeField} />
            </label>
          </div>
          <label style={{ display: 'grid', gap: 6 }}>
            <span>Keywords (optional)</span>
            <input name="tags" value={form.tags} onChange={changeField} placeholder="topic, module, unit" />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span>Learning material file{mode === 'edit' ? ' (optional)' : ''}</span>
            <input type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.zip" onChange={(event) => { setFile(event.target.files?.[0] || null); setIsDirty(true); }} />
            {mode === 'edit' && initialValues.originalName && <small>Current file: {initialValues.originalName}</small>}
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span>Cover image (optional)</span>
            <input type="file" accept="image/*" onChange={(event) => { setCoverImage(event.target.files?.[0] || null); setIsDirty(true); }} />
          </label>
          <p style={{ margin: 0, color: '#166534' }}>Course materials are free for students authorized to access this course.</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={requestClose}>Cancel</button>
            <button type="button" disabled={loading} onClick={() => submit('draft')}>Save draft</button>
            <button type="submit" disabled={loading || !courses.length}>{loading ? 'Saving…' : 'Publish material'}</button>
          </div>
        </form>
      </Modal>
      <ConfirmationDialog
        isOpen={confirmCloseOpen}
        title="Discard changes?"
        description="You have unsaved changes. Leaving now will discard them."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onConfirm={() => { setConfirmCloseOpen(false); onClose?.(); }}
        onCancel={() => setConfirmCloseOpen(false)}
      />
    </>
  );
}
