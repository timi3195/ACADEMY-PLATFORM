import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Modal from './Modal';
import NotificationBanner from './NotificationBanner';
import ConfirmationDialog from './ConfirmationDialog';
import { buildMaterialPayload } from '../utils/materialForm';

const emptyForm = {
  title: '',
  subtitle: '',
  description: '',
  authorName: '',
  course: '',
  department: '',
  faculty: 'Engineering',
  price: '0',
  discount: '0',
  visibility: 'public',
  level: 'ND1',
  semester: 'First Semester',
  materialType: 'Textbook',
  category: 'Book',
  previewPages: '5',
  pageCount: '0',
  tags: '',
  productStatus: 'draft',
  language: 'English',
  edition: '',
  publisher: '',
  status: 'draft',
  session: '2025/2026',
  courseCode: '',
  isbn: '',
  pricingMode: 'free',
  allowDownload: true,
  allowPreview: true
};

const stepLabels = ['Academic Information', 'Material Details', 'Files & Media', 'Pricing', 'Preview & Publish'];
const facultyOptions = ['Engineering', 'Science', 'Technology', 'Environmental', 'Management Sciences', 'Education', 'Arts', 'Social Sciences'];
const departmentOptions = ['Computer Science', 'Electrical Engineering', 'Civil Engineering', 'Business Administration', 'Accounting', 'Mass Communication', 'Mathematics', 'Physics', 'Chemistry', 'Statistics'];
const levelOptions = ['ND1', 'ND2', 'HND1', 'HND2'];
const semesterOptions = ['First Semester', 'Second Semester', 'Rain Semester', 'Harmattan Semester'];
const sessionOptions = ['2024/2025', '2025/2026', '2026/2027'];
const materialTypes = ['Book', 'Textbook'];

const validateForm = (form, file) => {
  const errors = [];
  if (!String(form.title || '').trim()) errors.push('Material title is required');
  if (!String(form.description || '').trim()) errors.push('Description is required');
  if (!String(form.course || '').trim()) errors.push('Course title is required');
  if (!String(form.courseCode || '').trim()) errors.push('Course code is required');
  if (!file) errors.push('A primary material file is required');
  const isPaid = form.pricingMode === 'paid';
  if (isPaid) {
    const price = Number(form.price || 0);
    if (!Number.isFinite(price) || price <= 0) errors.push('Paid materials need a price greater than 0');
  }
  return errors;
};

const MaterialFormModal = React.memo(function MaterialFormModal({ isOpen, onClose, mode = 'create', initialValues = {}, onSubmit, loading, error }) {
  const [form, setForm] = useState(emptyForm);
  const [file, setFile] = useState(null);
  const [coverImage, setCoverImage] = useState(null);
  const [previewSample, setPreviewSample] = useState(null);
  const [step, setStep] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [validationErrors, setValidationErrors] = useState([]);
  const [feedback, setFeedback] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const resetForm = {
      ...emptyForm,
      ...initialValues,
      price: initialValues.price ?? '0',
      discount: initialValues.discount ?? '0',
      previewPages: initialValues.previewPages ?? '5',
      visibility: initialValues.visibility || 'public',
      level: initialValues.level || 'ND1',
      semester: initialValues.semester || 'First Semester',
      status: initialValues.status || 'draft'
    };

    setForm(resetForm);
    setFile(null);
    setCoverImage(null);
    setPreviewSample(null);
    setStep(0);
    setUploadProgress(0);
    setValidationErrors([]);
    setFeedback('');
    setIsDirty(false);
    setConfirmCloseOpen(false);
  }, [initialValues, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const total = (file ? 34 : 0) + (coverImage ? 28 : 0) + (previewSample ? 18 : 0);
    setUploadProgress(total || 0);
  }, [file, coverImage, previewSample, isOpen]);

  const changeField = useCallback((event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setIsDirty(true);
  }, []);

  const handleFileChange = useCallback((event, type) => {
    const selected = event.target.files?.[0] || null;
    if (type === 'file') {
      setFile(selected);
    } else if (type === 'cover') {
      setCoverImage(selected);
    } else {
      setPreviewSample(selected);
    }
    setIsDirty(true);
  }, []);

  const handlePricingModeChange = useCallback((mode) => {
    setForm((prev) => ({ ...prev, pricingMode: mode, price: mode === 'free' ? '0' : prev.price || '0' }));
    setIsDirty(true);
  }, []);

  const handleCloseRequest = useCallback(() => {
    if (isDirty) {
      setConfirmCloseOpen(true);
      return;
    }
    onClose?.();
  }, [isDirty, onClose]);

  const submitWizard = useCallback(async (publish = true) => {
    const errors = validateForm(form, file);
    if (errors.length) {
      setValidationErrors(errors);
      setFeedback('');
      return;
    }

    const payload = buildMaterialPayload({ ...form, productStatus: publish ? 'published' : 'draft', status: publish ? 'published' : 'draft' });
    setValidationErrors([]);
    setFeedback('');
    try {
      await onSubmit(payload, file, coverImage);
      setFeedback(publish ? 'Material published successfully and is now live.' : 'Draft saved successfully.');
      setIsDirty(false);
      onClose?.();
    } catch (submitError) {
      setFeedback('');
      const message = submitError?.errors?.length ? submitError.errors.map((entry) => entry.message).join(' • ') : submitError?.message || 'Unable to save the material right now.';
      setValidationErrors([message]);
    }
  }, [coverImage, file, form, onClose, onSubmit]);

  const previewTitle = form.title || 'Untitled academic resource';
  const previewPrice = Number(form.price || 0);
  const previewDiscount = Number(form.discount || 0);
  const previewIsFree = form.pricingMode === 'free' || previewPrice === 0;
  const previewFinalAmount = previewIsFree ? 0 : Math.max(0, previewPrice - previewDiscount);
  const coverPreviewUrl = useMemo(() => (coverImage ? URL.createObjectURL(coverImage) : null), [coverImage]);
  const summary = useMemo(() => {
    const estimatedRevenue = previewIsFree ? 0 : Math.max(0, previewPrice - previewDiscount) * 0.92;
    return { estimatedRevenue, previewPages: Number(form.previewPages || 0), assetType: form.materialType || 'Lecture Note' };
  }, [form.discount, form.materialType, form.previewPages, form.price, previewIsFree]);

  const nextStep = useCallback(() => setStep((prev) => Math.min(prev + 1, stepLabels.length - 1)), []);
  const prevStep = useCallback(() => setStep((prev) => Math.max(prev - 1, 0)), []);

  const renderDropZone = (label, type, accept, selectedFile, description) => (
    <label style={{ display: 'grid', gap: '8px', padding: '12px', border: '1px dashed #0f3d91', borderRadius: '12px', background: '#f8fbff', cursor: 'pointer' }}>
      <span style={{ fontWeight: 700 }}>{label}</span>
      <span style={{ color: '#64748b', fontSize: '13px' }}>{description}</span>
      <input type="file" accept={accept} onChange={(event) => handleFileChange(event, type)} style={{ display: 'none' }} />
      {selectedFile ? <div style={{ fontSize: '13px', color: '#0f3d91', fontWeight: 600 }}>{selectedFile.name} • {Math.round(selectedFile.size / 1024)} KB</div> : <div style={{ fontSize: '13px', color: '#64748b' }}>Tap to select a file</div>}
    </label>
  );

  const renderStepContent = () => {
    switch (step) {
      case 0:
        return (
          <div style={{ display: 'grid', gap: '12px' }}>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px', color: '#475569' }}>
              Build the resource using the academic structure students already recognise: faculty, department, course, level, semester, and session.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <label style={{ display: 'grid', gap: '6px' }}>
                <span style={{ fontWeight: 600 }}>Faculty</span>
                <select name="faculty" value={form.faculty} onChange={changeField}>
                  {facultyOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <label style={{ display: 'grid', gap: '6px' }}>
                <span style={{ fontWeight: 600 }}>Department</span>
                <select name="department" value={form.department} onChange={changeField}>
                  {departmentOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <label style={{ display: 'grid', gap: '6px' }}>
                <span style={{ fontWeight: 600 }}>Level</span>
                <select name="level" value={form.level} onChange={changeField}>
                  {levelOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <label style={{ display: 'grid', gap: '6px' }}>
                <span style={{ fontWeight: 600 }}>Semester</span>
                <select name="semester" value={form.semester} onChange={changeField}>
                  {semesterOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <label style={{ display: 'grid', gap: '6px' }}>
                <span style={{ fontWeight: 600 }}>Course Code</span>
                <input name="courseCode" value={form.courseCode} onChange={changeField} placeholder="CSC 201" />
              </label>
              <label style={{ display: 'grid', gap: '6px' }}>
                <span style={{ fontWeight: 600 }}>Session</span>
                <select name="session" value={form.session} onChange={changeField}>
                  {sessionOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
            </div>
            <label style={{ display: 'grid', gap: '6px' }}>
              <span style={{ fontWeight: 600 }}>Course Title</span>
              <input name="course" value={form.course} onChange={changeField} placeholder="Data Structures" />
            </label>
            <label style={{ display: 'grid', gap: '6px' }}>
              <span style={{ fontWeight: 600 }}>Lecturer Name</span>
              <input name="authorName" value={form.authorName} onChange={changeField} readOnly />
            </label>
          </div>
        );
      case 1:
        return (
          <div style={{ display: 'grid', gap: '12px' }}>
            <label style={{ display: 'grid', gap: '6px' }}>
              <span style={{ fontWeight: 600 }}>Material Title</span>
              <input name="title" value={form.title} onChange={changeField} required placeholder="Introduction to Algorithms" />
            </label>
            <label style={{ display: 'grid', gap: '6px' }}>
              <span style={{ fontWeight: 600 }}>Subtitle</span>
              <input name="subtitle" value={form.subtitle} onChange={changeField} placeholder="Lecture notes for first semester" />
            </label>
            <label style={{ display: 'grid', gap: '6px' }}>
              <span style={{ fontWeight: 600 }}>Description</span>
              <textarea name="description" value={form.description} onChange={changeField} rows={4} required placeholder="Describe the academic value of this resource for students." />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <label style={{ display: 'grid', gap: '6px' }}>
                <span style={{ fontWeight: 600 }}>Edition</span>
                <input name="edition" value={form.edition} onChange={changeField} placeholder="1st edition" />
              </label>
              <label style={{ display: 'grid', gap: '6px' }}>
                <span style={{ fontWeight: 600 }}>Publisher</span>
                <input name="publisher" value={form.publisher} onChange={changeField} placeholder="Department Press" />
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <label style={{ display: 'grid', gap: '6px' }}>
                <span style={{ fontWeight: 600 }}>Language</span>
                <input name="language" value={form.language} onChange={changeField} placeholder="English" />
              </label>
              <label style={{ display: 'grid', gap: '6px' }}>
                <span style={{ fontWeight: 600 }}>ISBN</span>
                <input name="isbn" value={form.isbn} onChange={changeField} placeholder="Optional" />
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <label style={{ display: 'grid', gap: '6px' }}>
                <span style={{ fontWeight: 600 }}>Material Type</span>
                <select name="materialType" value={form.materialType} onChange={changeField}>
                  {materialTypes.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <label style={{ display: 'grid', gap: '6px' }}>
                <span style={{ fontWeight: 600 }}>Pages</span>
                <input name="pageCount" type="number" min="0" value={form.pageCount} onChange={changeField} placeholder="0" />
              </label>
            </div>
            <label style={{ display: 'grid', gap: '6px' }}>
              <span style={{ fontWeight: 600 }}>Keywords</span>
              <input name="tags" value={form.tags} onChange={changeField} placeholder="algorithms, data structures, semester 1" />
            </label>
          </div>
        );
      case 2:
        return (
          <div style={{ display: 'grid', gap: '12px' }}>
            <div style={{ border: '1px dashed #0f3d91', borderRadius: '12px', padding: '14px', background: '#f8fbff' }}>
              <strong style={{ display: 'block', marginBottom: '6px' }}>Upload academic files</strong>
              <p style={{ margin: 0, color: '#475569' }}>Add the main material, a cover image, and an optional preview sample.</p>
            </div>
            <div style={{ display: 'grid', gap: '10px' }}>
              {renderDropZone('Material PDF', 'file', '.pdf,.doc,.docx,.ppt,.pptx,.zip', file, 'Primary resource file for students')} 
              {renderDropZone('Cover image', 'cover', 'image/*', coverImage, 'A polished cover for the marketplace card')} 
              {renderDropZone('Preview PDF', 'sample', '.pdf', previewSample, 'Optional preview sample for students')} 
            </div>
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px', display: 'grid', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                <span>Upload readiness</span>
                <span>{uploadProgress}%</span>
              </div>
              <div style={{ height: '8px', borderRadius: '999px', background: '#e2e8f0', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${uploadProgress}%`, background: 'linear-gradient(90deg, #0f3d91, #f2b84b)' }} />
              </div>
              <div style={{ fontSize: '13px', color: '#64748b' }}>{file ? `Primary file ready: ${file.name}` : 'Select the main resource file to continue.'}</div>
            </div>
          </div>
        );
      case 3:
        return (
          <div style={{ display: 'grid', gap: '12px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <label style={{ display: 'grid', gap: '6px' }}>
                <span style={{ fontWeight: 600 }}>Access Type</span>
                <select value={form.pricingMode} onChange={(event) => handlePricingModeChange(event.target.value)}>
                  <option value="free">Free</option>
                  <option value="paid">Paid</option>
                </select>
              </label>
              <label style={{ display: 'grid', gap: '6px' }}>
                <span style={{ fontWeight: 600 }}>Price</span>
                <input name="price" type="number" min="0" value={form.price} onChange={changeField} disabled={form.pricingMode === 'free'} />
              </label>
            </div>
            <label style={{ display: 'grid', gap: '6px' }}>
              <span style={{ fontWeight: 600 }}>Discount</span>
              <input name="discount" type="number" min="0" value={form.discount} onChange={changeField} />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <label style={{ display: 'grid', gap: '6px' }}>
                <span style={{ fontWeight: 600 }}>Preview Pages</span>
                <input name="previewPages" type="number" min="0" value={form.previewPages} onChange={changeField} />
              </label>
              <label style={{ display: 'grid', gap: '6px' }}>
                <span style={{ fontWeight: 600 }}>Allow Download</span>
                <select value={form.allowDownload ? 'yes' : 'no'} onChange={(event) => setForm((prev) => ({ ...prev, allowDownload: event.target.value === 'yes' }))}>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>
            </div>
            <label style={{ display: 'grid', gap: '6px' }}>
              <span style={{ fontWeight: 600 }}>Allow Preview</span>
              <select value={form.allowPreview ? 'yes' : 'no'} onChange={(event) => setForm((prev) => ({ ...prev, allowPreview: event.target.value === 'yes' }))}>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px', color: '#475569' }}>
              Estimated earnings after platform charges: ₦{Math.round(summary.estimatedRevenue).toLocaleString()}
            </div>
          </div>
        );
      case 4:
        return (
          <div style={{ display: 'grid', gap: '12px' }}>
            <div style={{ borderRadius: '16px', border: '1px solid #e2e8f0', background: 'linear-gradient(135deg, #f8fbff, #ffffff)', padding: '16px', display: 'grid', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                <div>
                  <div style={{ color: '#0f3d91', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>Publication Preview</div>
                  <h3 style={{ margin: '4px 0', fontSize: '1.1rem' }}>{previewTitle}</h3>
                  <div style={{ color: '#64748b' }}>{form.courseCode || 'Course Code'} • {form.department || 'Department'} • {form.level || 'Level'}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 800, fontSize: '1.2rem' }}>₦{previewFinalAmount.toLocaleString()}</div>
                  <div style={{ color: '#64748b', fontSize: '12px' }}>{previewIsFree ? 'Free resource' : 'Paid resource'}</div>
                </div>
              </div>
              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px' }}>
                <div style={{ fontSize: '12px', color: '#0f3d91', fontWeight: 700, textTransform: 'uppercase' }}>Academic Resource</div>
                <div style={{ fontWeight: 700, marginTop: '4px' }}>{form.materialType || 'Lecture Note'}</div>
                <div style={{ color: '#64748b', marginTop: '6px' }}>{form.description || 'A clear academic description will appear here for students.'}</div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                <span style={{ background: '#eff6ff', color: '#0f3d91', padding: '6px 10px', borderRadius: '999px', fontSize: '12px' }}>{form.faculty || 'Faculty'}</span>
                <span style={{ background: '#fef3c7', color: '#92400e', padding: '6px 10px', borderRadius: '999px', fontSize: '12px' }}>{form.semester || 'Semester'}</span>
                <span style={{ background: '#ecfdf3', color: '#15803d', padding: '6px 10px', borderRadius: '999px', fontSize: '12px' }}>{form.session || 'Session'}</span>
              </div>
            </div>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px', display: 'grid', gap: '6px' }}>
              <div><strong>Visibility:</strong> {form.visibility}</div>
              <div><strong>Status:</strong> {form.productStatus}</div>
              <div><strong>Preview pages:</strong> {form.previewPages || 0}</div>
              <div><strong>Estimated earnings:</strong> ₦{Math.round(summary.estimatedRevenue).toLocaleString()}</div>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={handleCloseRequest} fullscreen title={mode === 'edit' ? 'Edit academic material' : 'Create New Course Material'}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) 320px', gap: '20px', alignItems: 'start' }}>
          <div>
            <form onSubmit={(event) => { event.preventDefault(); submitWizard(true); }} style={{ display: 'grid', gap: '14px' }}>
              {error && <NotificationBanner type="error" message={error} />}
              {validationErrors.length > 0 && <NotificationBanner type="error" message={validationErrors.join(' • ')} />}
              {feedback && <NotificationBanner type="success" message={feedback} />}

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {stepLabels.map((label, index) => (
                  <div key={label} style={{ padding: '6px 10px', borderRadius: '999px', background: index === step ? '#0f3d91' : '#e2e8f0', color: index === step ? '#fff' : '#475569', fontSize: '12px', fontWeight: 700 }}>
                    {index + 1}. {label}
                  </div>
                ))}
              </div>

              {renderStepContent()}

              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginTop: '4px', flexWrap: 'wrap', position: 'sticky', bottom: 0, padding: '12px 0 0', background: 'white' }}>
                <div>
                  {step > 0 && <button type="button" onClick={prevStep}>Back</button>}
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button type="button" onClick={handleCloseRequest}>Cancel</button>
                  <button type="button" onClick={() => submitWizard(false)}>Save Draft</button>
                  {step < stepLabels.length - 1 ? (
                    <button type="button" onClick={nextStep}>Next</button>
                  ) : (
                    <button type="submit" disabled={loading}>{loading ? 'Publishing...' : 'Publish material'}</button>
                  )}
                </div>
              </div>
            </form>
          </div>

          <aside style={{ display: 'grid', gap: '12px', position: 'sticky', top: '24px' }}>
            <div style={{ borderRadius: '16px', border: '1px solid #e2e8f0', overflow: 'hidden', background: '#fff' }}>
              <div style={{ padding: '16px', borderBottom: '1px solid #e2e8f0', background: 'linear-gradient(135deg, #0f3d91, #2563eb)', color: '#fff' }}>
                <div style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '.08em' }}>Live marketplace preview</div>
                <div style={{ fontSize: '18px', fontWeight: 700, marginTop: '6px' }}>{previewTitle}</div>
              </div>
              <div style={{ padding: '16px', display: 'grid', gap: '12px' }}>
                <div style={{ borderRadius: '12px', overflow: 'hidden', background: 'linear-gradient(135deg, #dbeafe, #f8fafc)', minHeight: '180px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {coverPreviewUrl ? <img src={coverPreviewUrl} alt="Cover preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ textAlign: 'center', padding: '20px', color: '#0f3d91' }}><div style={{ fontSize: '42px', fontWeight: 800 }}>{(form.courseCode || previewTitle).slice(0, 2).toUpperCase()}</div><div style={{ marginTop: '8px', fontWeight: 700 }}>{form.courseCode || 'Course Code'}</div><div style={{ color: '#64748b', fontSize: '12px', marginTop: '4px' }}>{previewTitle}</div></div>}
                </div>
                <div style={{ display: 'grid', gap: '6px', color: '#475569' }}>
                  <div><strong>Course code:</strong> {form.courseCode || '—'}</div>
                  <div><strong>Department:</strong> {form.department || '—'}</div>
                  <div><strong>Level:</strong> {form.level || '—'}</div>
                  <div><strong>Semester:</strong> {form.semester || '—'}</div>
                  <div><strong>Material type:</strong> {form.materialType || 'Lecture Note'}</div>
                  <div><strong>Lecturer:</strong> {form.authorName || 'Lecturer'}</div>
                  <div><strong>Price:</strong> ₦{previewFinalAmount.toLocaleString()}</div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </Modal>
      <ConfirmationDialog
        isOpen={confirmCloseOpen}
        title="Discard changes?"
        description="You have unsaved changes. Leaving now will discard them."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onConfirm={() => {
          setConfirmCloseOpen(false);
          onClose?.();
        }}
        onCancel={() => setConfirmCloseOpen(false)}
      />
    </>
  );
});

export default MaterialFormModal;
