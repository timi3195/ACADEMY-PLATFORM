import React, { useEffect, useMemo, useState } from 'react';
import Modal from './Modal';
import NotificationBanner from './NotificationBanner';
import { buildMaterialPayload } from '../utils/materialForm';

const emptyForm = {
  title: '',
  subtitle: '',
  description: '',
  authorName: '',
  course: '',
  department: '',
  price: '0',
  discount: '0',
  visibility: 'public',
  level: 'Other',
  semester: 'First',
  materialType: 'PDF',
  category: 'PDF',
  previewPages: '5',
  pageCount: '0',
  tags: '',
  productStatus: 'draft',
  language: 'en',
  edition: '',
  publisher: '',
  status: 'pending'
};

const stepLabels = ['Basic info', 'Book media', 'Pricing', 'Marketplace', 'Review'];

export default function MaterialFormModal({ isOpen, onClose, mode = 'create', initialValues = {}, onSubmit, loading, error }) {
  const [form, setForm] = useState(emptyForm);
  const [file, setFile] = useState(null);
  const [coverImage, setCoverImage] = useState(null);
  const [step, setStep] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);

  useEffect(() => {
    if (isOpen) {
      setForm({
        ...emptyForm,
        ...initialValues,
        price: initialValues.price ?? '0',
        discount: initialValues.discount ?? '0',
        previewPages: initialValues.previewPages ?? '5',
        visibility: initialValues.visibility || 'public',
        level: initialValues.level || 'Other',
        status: initialValues.status || 'pending'
      });
      setFile(null);
      setCoverImage(null);
      setStep(0);
      setUploadProgress(0);
    }
  }, [isOpen, initialValues]);

  useEffect(() => {
    if (!isOpen) return;
    if (file || coverImage) {
      setUploadProgress(68);
    } else {
      setUploadProgress(0);
    }
  }, [file, coverImage, isOpen]);

  const changeField = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (event, type) => {
    const selected = event.target.files?.[0] || null;
    if (type === 'file') {
      setFile(selected);
      setForm((prev) => ({ ...prev, pageCount: selected?.name ? prev.pageCount : prev.pageCount }));
    } else {
      setCoverImage(selected);
    }
    setUploadProgress(selected ? 78 : 0);
  };

  const handleSubmit = (event) => {
    event.preventDefault();

    const payload = buildMaterialPayload(form);
    onSubmit(payload, file, coverImage);
  };

  const previewTitle = form.title || 'Untitled product';
  const previewAuthor = form.authorName || 'Author name';
  const previewPrice = Number(form.price || 0);
  const previewDiscount = Number(form.discount || 0);
  const previewIsFree = previewPrice === 0;
  const previewFinalAmount = previewIsFree ? 0 : Math.max(0, previewPrice - previewDiscount);
  const summary = useMemo(() => {
    const estimatedRevenue = previewIsFree ? 0 : Math.max(0, previewPrice - previewDiscount) * 0.92;
    return {
      estimatedRevenue,
      previewPages: Number(form.previewPages || 0),
      assetType: form.materialType || 'PDF'
    };
  }, [form.discount, form.materialType, form.previewPages, form.price, previewIsFree]);

  const nextStep = () => setStep((prev) => Math.min(prev + 1, stepLabels.length - 1));
  const prevStep = () => setStep((prev) => Math.max(prev - 1, 0));

  const renderStepContent = () => {
    switch (step) {
      case 0:
        return (
          <div style={{ display: 'grid', gap: '12px' }}>
            <label style={{ display: 'grid', gap: '6px' }}>
              <span style={{ fontWeight: 600 }}>Title</span>
              <input name="title" value={form.title} onChange={changeField} required />
            </label>
            <label style={{ display: 'grid', gap: '6px' }}>
              <span style={{ fontWeight: 600 }}>Subtitle</span>
              <input name="subtitle" value={form.subtitle} onChange={changeField} placeholder="Short supporting title" />
            </label>
            <label style={{ display: 'grid', gap: '6px' }}>
              <span style={{ fontWeight: 600 }}>Description</span>
              <textarea name="description" value={form.description} onChange={changeField} rows={4} required />
            </label>
            <label style={{ display: 'grid', gap: '6px' }}>
              <span style={{ fontWeight: 600 }}>Author name</span>
              <input name="authorName" value={form.authorName} onChange={changeField} placeholder="Dr. Ada Lovelace" />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <label style={{ display: 'grid', gap: '6px' }}>
                <span style={{ fontWeight: 600 }}>Department</span>
                <input name="department" value={form.department} onChange={changeField} placeholder="Department ObjectId" />
              </label>
              <label style={{ display: 'grid', gap: '6px' }}>
                <span style={{ fontWeight: 600 }}>Course</span>
                <input name="course" value={form.course} onChange={changeField} required placeholder="Course ObjectId" />
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
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
              <label style={{ display: 'grid', gap: '6px' }}>
                <span style={{ fontWeight: 600 }}>Semester</span>
                <select name="semester" value={form.semester} onChange={changeField}>
                  <option value="First">First</option>
                  <option value="Second">Second</option>
                </select>
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <label style={{ display: 'grid', gap: '6px' }}>
                <span style={{ fontWeight: 600 }}>Material type</span>
                <select name="materialType" value={form.materialType} onChange={changeField}>
                  <option value="PDF">PDF</option>
                  <option value="DOCX">DOCX</option>
                  <option value="PPT">PPT</option>
                  <option value="ZIP">ZIP</option>
                  <option value="Video">Video</option>
                  <option value="Book">Book</option>
                  <option value="Lab Manual">Lab Manual</option>
                  <option value="Assignment">Assignment</option>
                  <option value="Past Question">Past Question</option>
                  <option value="Other">Other</option>
                </select>
              </label>
              <label style={{ display: 'grid', gap: '6px' }}>
                <span style={{ fontWeight: 600 }}>Language</span>
                <input name="language" value={form.language} onChange={changeField} placeholder="en" />
              </label>
            </div>
          </div>
        );
      case 1:
        return (
          <div style={{ display: 'grid', gap: '12px' }}>
            <label style={{ display: 'grid', gap: '6px' }}>
              <span style={{ fontWeight: 600 }}>Cover image</span>
              <input type="file" accept="image/*" onChange={(event) => handleFileChange(event, 'cover')} />
            </label>
            <label style={{ display: 'grid', gap: '6px' }}>
              <span style={{ fontWeight: 600 }}>Material PDF</span>
              <input type="file" accept="application/pdf" onChange={(event) => handleFileChange(event, 'file')} required={mode !== 'edit'} />
            </label>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px', display: 'grid', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                <span>Upload progress</span>
                <span>{uploadProgress}%</span>
              </div>
              <div style={{ height: '8px', borderRadius: '999px', background: '#e2e8f0', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${uploadProgress}%`, background: 'linear-gradient(90deg, #2563eb, #4f46e5)' }} />
              </div>
              <div style={{ fontSize: '13px', color: '#64748b' }}>
                {file ? `Material ready: ${file.name}` : 'Select a PDF to continue.'}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <label style={{ display: 'grid', gap: '6px' }}>
                <span style={{ fontWeight: 600 }}>Edition</span>
                <input name="edition" value={form.edition} onChange={changeField} placeholder="1st edition" />
              </label>
              <label style={{ display: 'grid', gap: '6px' }}>
                <span style={{ fontWeight: 600 }}>Publisher</span>
                <input name="publisher" value={form.publisher} onChange={changeField} placeholder="Campus Press" />
              </label>
            </div>
          </div>
        );
      case 2:
        return (
          <div style={{ display: 'grid', gap: '12px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <label style={{ display: 'grid', gap: '6px' }}>
                <span style={{ fontWeight: 600 }}>Pricing model</span>
                <select name="pricingModel" value={previewIsFree ? 'free' : 'paid'} onChange={(event) => setForm((prev) => ({ ...prev, price: event.target.value === 'free' ? '0' : prev.price || '0' }))}>
                  <option value="free">Free</option>
                  <option value="paid">Paid</option>
                </select>
              </label>
              <label style={{ display: 'grid', gap: '6px' }}>
                <span style={{ fontWeight: 600 }}>Price</span>
                <input name="price" type="number" min="0" value={form.price} onChange={changeField} disabled={previewIsFree} />
              </label>
            </div>
            <label style={{ display: 'grid', gap: '6px' }}>
              <span style={{ fontWeight: 600 }}>Discount</span>
              <input name="discount" type="number" min="0" value={form.discount} onChange={changeField} />
            </label>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px', color: '#475569' }}>
              You will receive approximately ₦{Math.round(summary.estimatedRevenue).toLocaleString()} after platform charges.
            </div>
          </div>
        );
      case 3:
        return (
          <div style={{ display: 'grid', gap: '12px' }}>
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
                <span style={{ fontWeight: 600 }}>Status</span>
                <select name="productStatus" value={form.productStatus} onChange={changeField}>
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                  <option value="archived">Archived</option>
                </select>
              </label>
            </div>
            <label style={{ display: 'grid', gap: '6px' }}>
              <span style={{ fontWeight: 600 }}>Preview pages</span>
              <input name="previewPages" type="number" min="0" value={form.previewPages} onChange={changeField} />
            </label>
            <label style={{ display: 'grid', gap: '6px' }}>
              <span style={{ fontWeight: 600 }}>Tags</span>
              <input name="tags" value={form.tags} onChange={changeField} placeholder="math,exam,notes" />
            </label>
            <label style={{ display: 'grid', gap: '6px' }}>
              <span style={{ fontWeight: 600 }}>Category</span>
              <select name="category" value={form.category} onChange={changeField}>
                <option value="Book">Book</option>
                <option value="Lecture Notes">Lecture Notes</option>
                <option value="Lab Manual">Lab Manual</option>
                <option value="Assignment">Assignment</option>
                <option value="Past Question">Past Question</option>
                <option value="Video">Video</option>
                <option value="PDF">PDF</option>
                <option value="DOCX">DOCX</option>
                <option value="PPT">PPT</option>
                <option value="ZIP">ZIP</option>
                <option value="Other">Other</option>
              </select>
            </label>
          </div>
        );
      case 4:
        return (
          <div style={{ display: 'grid', gap: '12px' }}>
            <div className="product-card" style={{ maxWidth: '420px' }}>
              <div className="product-card__media">
                <div className="product-card__placeholder">
                  <span>{previewTitle.charAt(0).toUpperCase()}</span>
                  <small>{form.materialType || 'Resource'}</small>
                </div>
              </div>
              <div className="product-card__content">
                <div className="product-card__top-row">
                  <span className="product-card__type">{form.materialType || 'PDF'}</span>
                  <span className="product-card__free-pill">{previewIsFree ? 'FREE' : 'PAID'}</span>
                </div>
                <div>
                  <h3>{previewTitle}</h3>
                  <p>{form.description || 'Your marketplace description will appear here.'}</p>
                </div>
                <div className="product-card__meta-row">
                  <span>{previewAuthor}</span>
                  <span>{form.department || 'Department'}</span>
                  <span>{form.course || 'Course'}</span>
                </div>
                <div className="product-card__stats-row">
                  <span>📄 {form.previewPages || 0}</span>
                  <span>⭐ 4.8</span>
                  <span>⬇️ 1.2k</span>
                </div>
                <div className="product-card__price-row">
                  <strong>₦{previewFinalAmount.toLocaleString()}</strong>
                  {previewDiscount > 0 && <span style={{ color: '#64748b', textDecoration: 'line-through' }}>₦{previewPrice.toLocaleString()}</span>}
                </div>
              </div>
            </div>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px', display: 'grid', gap: '6px' }}>
              <div><strong>Visibility:</strong> {form.visibility}</div>
              <div><strong>Status:</strong> {form.productStatus}</div>
              <div><strong>Preview pages:</strong> {form.previewPages || 0}</div>
              <div><strong>Estimated payout:</strong> ₦{Math.round(summary.estimatedRevenue).toLocaleString()}</div>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={mode === 'edit' ? 'Edit material' : 'Publish a new book'}>
      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '14px' }}>
        {error && <NotificationBanner type="error" message={error} />}

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {stepLabels.map((label, index) => (
            <div key={label} style={{ padding: '6px 10px', borderRadius: '999px', background: index === step ? '#0f172a' : '#e2e8f0', color: index === step ? '#fff' : '#475569', fontSize: '12px', fontWeight: 700 }}>
              {index + 1}. {label}
            </div>
          ))}
        </div>

        {renderStepContent()}

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginTop: '4px' }}>
          <div>
            {step > 0 && <button type="button" onClick={prevStep}>Back</button>}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="button" onClick={onClose}>Cancel</button>
            {step < stepLabels.length - 1 ? (
              <button type="button" onClick={nextStep}>Next</button>
            ) : (
              <button type="submit" disabled={loading}>{loading ? 'Publishing...' : 'Publish material'}</button>
            )}
          </div>
        </div>
      </form>
    </Modal>
  );
}
