import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../services/apiClient';

const formatBytes = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
const isAllowedImage = (file) =>
  /\.(jpe?g|png)$/i.test(file.name) &&
  ['image/jpeg', 'image/png'].includes(file.type);

const toDraftForm = (draft) => ({
  questionNumber: draft.questionNumber || '',
  questionText: draft.questionText || '',
  options: (draft.options || []).map((option) => ({
    optionId: option.optionId || '',
    text: option.text || ''
  })),
  confirmedAnswerOptionId: draft.confirmedAnswerOptionId || '',
  confirmCorrectAnswer: Boolean(draft.answerConfirmedAt && draft.answerConfirmedBy),
  explanation: draft.explanation || '',
  topic: draft.topic || '',
  difficulty: draft.difficulty || 'medium',
  marks: draft.marks ?? 2
});

export default function LecturerQuestionExtractions() {
  const [courses, setCourses] = useState([]);
  const [limits, setLimits] = useState({ maxImages: 8, maxImageBytes: 8 * 1024 * 1024, maxBatchBytes: 32 * 1024 * 1024 });
  const [batches, setBatches] = useState([]);
  const [files, setFiles] = useState([]);
  const [selectedCourse, setSelectedCourse] = useState('');
  const [academicSession, setAcademicSession] = useState('');
  const [sourceExamYear, setSourceExamYear] = useState('');
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [validationErrors, setValidationErrors] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [retryingBatch, setRetryingBatch] = useState('');
  const [protectedPreviews, setProtectedPreviews] = useState([]);
  const [draftForms, setDraftForms] = useState({});
  const [selectedDraftIds, setSelectedDraftIds] = useState([]);
  const [reviewMessage, setReviewMessage] = useState('');
  const [reviewError, setReviewError] = useState('');
  const [reviewing, setReviewing] = useState(false);

  useEffect(() => {
    if (!selectedBatch) {
      setDraftForms({});
      setSelectedDraftIds([]);
      return;
    }
    setDraftForms(Object.fromEntries((selectedBatch.drafts || []).map((draft) => [
      draft._id,
      toDraftForm(draft)
    ])));
    setSelectedDraftIds([]);
  }, [selectedBatch]);

  const previews = useMemo(() => files.map((file) => ({
    file,
    url: URL.createObjectURL(file)
  })), [files]);

  useEffect(() => () => previews.forEach(({ url }) => URL.revokeObjectURL(url)), [previews]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [courseResponse, limitResponse, batchResponse] = await Promise.all([
        apiClient.get('/api/question-extractions/courses'),
        apiClient.get('/api/question-extractions/limits'),
        apiClient.get('/api/question-extractions')
      ]);
      setCourses(courseResponse.data.courses || []);
      setLimits((current) => ({ ...current, ...(limitResponse.data.limits || {}) }));
      setBatches(batchResponse.data.batches || []);
      setError('');
    } catch (requestError) {
      setError(requestError.message || 'Unable to load question extraction data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const addFiles = (selectedFiles) => {
    const incoming = Array.from(selectedFiles || []);
    const errors = [];
    const valid = [];
    for (const file of incoming) {
      if (!isAllowedImage(file)) {
        errors.push(`${file.name}: select a JPG, JPEG, or PNG image.`);
      } else if (file.size > limits.maxImageBytes) {
        errors.push(`${file.name}: image exceeds ${formatBytes(limits.maxImageBytes)}.`);
      } else {
        valid.push(file);
      }
    }

    const combined = [...files, ...valid];
    if (combined.length > limits.maxImages) {
      errors.push(`A batch can contain at most ${limits.maxImages} images.`);
      setFiles(combined.slice(0, limits.maxImages));
    } else {
      const totalBytes = combined.reduce((sum, file) => sum + file.size, 0);
      if (totalBytes > limits.maxBatchBytes) {
        errors.push(`The selected batch exceeds ${formatBytes(limits.maxBatchBytes)}.`);
        setFiles(files);
      } else {
        setFiles(combined);
      }
    }
    setValidationErrors(errors);
  };

  const removeFile = (target) => {
    setFiles((current) => current.filter((file) => file !== target));
  };

  const submitUpload = async (event) => {
    event.preventDefault();
    setError('');
    setValidationErrors([]);
    if (!selectedCourse || !academicSession || files.length === 0) {
      setError('Choose a course, enter the academic session, and select at least one image.');
      return;
    }

    const form = new FormData();
    form.append('courseId', selectedCourse);
    form.append('academicSession', academicSession);
    form.append('sourceExamYear', sourceExamYear);
    files.forEach((file) => form.append('images', file));

    try {
      setUploading(true);
      setUploadProgress(0);
      const response = await apiClient.post('/api/question-extractions', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (progress) => {
          if (progress.total) setUploadProgress(Math.round((progress.loaded / progress.total) * 100));
        }
      });
      setSelectedBatch(response.data.batch);
      setFiles([]);
      setUploadProgress(100);
      await loadData();
    } catch (requestError) {
      setError(requestError.message || 'Question image upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const openBatch = async (batchId) => {
    try {
      setError('');
      const response = await apiClient.get(`/api/question-extractions/${encodeURIComponent(batchId)}`);
      setSelectedBatch(response.data.batch);
    } catch (requestError) {
      setError(requestError.message || 'Unable to open extraction batch.');
    }
  };

  const retryBatch = async (batch) => {
    try {
      setError('');
      setRetryingBatch(batch.batchId);
      const detail = await apiClient.get(`/api/question-extractions/${encodeURIComponent(batch.batchId)}`);
      const hasIncompleteOcr = detail.data.batch.images?.some((image) => image.ocrStatus !== 'succeeded');
      const stage = hasIncompleteOcr ? 'ocr' : 'structuring';
      const response = await apiClient.post(`/api/question-extractions/${encodeURIComponent(batch.batchId)}/retry`, { stage });
      setSelectedBatch(response.data.batch);
      await loadData();
    } catch (requestError) {
      setError(requestError.message || 'Unable to retry extraction.');
    } finally {
      setRetryingBatch('');
    }
  };

  const saveDraft = async (draftId, showMessage = true) => {
    const form = draftForms[draftId];
    if (!form || !selectedBatch) return;
    const response = await apiClient.patch(
      `/api/question-extractions/${encodeURIComponent(selectedBatch.batchId)}/drafts/${encodeURIComponent(draftId)}`,
      form
    );
    setSelectedBatch(response.data.batch);
    if (showMessage) setReviewMessage('Draft corrections saved. The original extraction remains in the review history.');
    return response.data.batch;
  };

  const approveDraft = async (draftId) => {
    const draft = selectedBatch?.drafts?.find((item) => item._id === draftId);
    if (!draft || !window.confirm('Approve this reviewed question for the approved question bank? This will make it available to CBT.')) return;
    try {
      setReviewing(true);
      setReviewError('');
      setReviewMessage('');
      await saveDraft(draftId, false);
      const response = await apiClient.post(
        `/api/question-extractions/${encodeURIComponent(selectedBatch.batchId)}/drafts/${encodeURIComponent(draftId)}/approve`
      );
      setSelectedBatch(response.data.batch);
      await loadData();
      setReviewMessage(response.data.alreadyApproved ? 'This question was already approved.' : 'Question approved and added to the question bank.');
    } catch (requestError) {
      setReviewError(requestError.message || 'Unable to approve this draft.');
    } finally {
      setReviewing(false);
    }
  };

  const rejectDraft = async (draftId) => {
    const draft = selectedBatch?.drafts?.find((item) => item._id === draftId);
    if (!draft || !window.confirm('Reject this draft? It will remain in extraction history and will not enter the question bank.')) return;
    const reason = window.prompt('Optional rejection reason:') || '';
    try {
      setReviewing(true);
      setReviewError('');
      setReviewMessage('');
      await saveDraft(draftId, false);
      const response = await apiClient.post(
        `/api/question-extractions/${encodeURIComponent(selectedBatch.batchId)}/drafts/${encodeURIComponent(draftId)}/reject`,
        { reason }
      );
      setSelectedBatch(response.data.batch);
      await loadData();
      setReviewMessage('Draft rejected and retained in extraction history.');
    } catch (requestError) {
      setReviewError(requestError.message || 'Unable to reject this draft.');
    } finally {
      setReviewing(false);
    }
  };

  const reviewSelected = async (action) => {
    if (!selectedBatch || selectedDraftIds.length === 0) return;
    const actionLabel = action === 'approve' ? 'approve' : 'reject';
    if (!window.confirm(`${actionLabel === 'approve' ? 'Approve' : 'Reject'} ${selectedDraftIds.length} selected draft(s)? Each question is checked independently.`)) return;
    const reason = action === 'reject' ? window.prompt('Optional rejection reason for all selected drafts:') || '' : '';
    try {
      setReviewing(true);
      setReviewError('');
      setReviewMessage('');
      await Promise.all(selectedDraftIds.map((draftId) => saveDraft(draftId, false)));
      const response = await apiClient.post(
        `/api/question-extractions/${encodeURIComponent(selectedBatch.batchId)}/review-selected`,
        { action, draftIds: selectedDraftIds, reason }
      );
      setSelectedBatch(response.data.batch);
      await loadData();
      const successes = response.data.results.filter((result) => result.success).length;
      const failures = response.data.results.length - successes;
      setReviewMessage(`${successes} draft(s) ${actionLabel === 'approve' ? 'approved' : 'rejected'}${failures ? `; ${failures} failed validation or review` : ''}.`);
      if (failures) {
        setReviewError(response.data.results.filter((result) => !result.success)
          .map((result) => `${result.draftId}: ${result.message}`).join(' '));
      }
    } catch (requestError) {
      setReviewError(requestError.message || `Unable to ${actionLabel} selected drafts.`);
    } finally {
      setReviewing(false);
    }
  };

  const updateDraftForm = (draftId, transform) => {
    setDraftForms((current) => ({
      ...current,
      [draftId]: transform(current[draftId])
    }));
  };

  const imageKey = (selectedBatch?.images || []).map((image) => image.id).join(',');
  useEffect(() => {
    let active = true;
    const objectUrls = [];
    if (!selectedBatch?.images?.length) {
      setProtectedPreviews([]);
      return () => {};
    }

    Promise.all(selectedBatch.images.map(async (image) => {
      const { data } = await apiClient.get(image.previewUrl, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      objectUrls.push(url);
      return { image, url };
    })).then((previews) => {
      if (active) setProtectedPreviews(previews);
    }).catch((previewError) => {
      if (active) setError(previewError.message || 'Unable to load protected original images.');
    });

    return () => {
      active = false;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [selectedBatch?.batchId, imageKey]);

  if (loading) {
    return <main className="page"><section className="wp-section">Loading question extraction workspace…</section></main>;
  }

  return (
    <main className="page">
      <section className="wp-section" style={{ marginBottom: 20 }}>
        <Link to="/lecturer" style={{ color: '#2563eb' }}>← Lecturer dashboard</Link>
        <h1 style={{ marginBottom: 8 }}>Past-question image extraction</h1>
        <p style={{ color: '#64748b', marginTop: 0 }}>
          Upload clear exam photographs for OCR and draft structuring. Every result stays unapproved until a later lecturer review.
        </p>
        <p style={{ color: '#64748b' }}>
          JPG/JPEG/PNG only · up to {limits.maxImages} images · {formatBytes(limits.maxImageBytes)} each · {formatBytes(limits.maxBatchBytes)} per batch
        </p>
      </section>

      {(error || reviewError) && <div role="alert" className="wp-section" style={{ color: '#b91c1c', marginBottom: 16 }}>{reviewError || error}</div>}
      {reviewMessage && <div role="status" className="wp-section" style={{ color: '#166534', marginBottom: 16 }}>{reviewMessage}</div>}

      <section className="wp-section" style={{ marginBottom: 20 }}>
        <h2>Upload source images</h2>
        {courses.length === 0 ? (
          <p>No courses are assigned to this account. Contact an administrator if a course assignment is missing.</p>
        ) : (
          <form onSubmit={submitUpload}>
            <label style={{ display: 'block', marginBottom: 12 }}>
              Course
              <select value={selectedCourse} onChange={(event) => setSelectedCourse(event.target.value)} required style={{ display: 'block', width: '100%', marginTop: 6, padding: 10 }}>
                <option value="">Select an authorized course</option>
                {courses.map((course) => (
                  <option key={course._id} value={course._id}>{course.code} — {course.title} ({course.level}, {course.semester})</option>
                ))}
              </select>
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <label>
                Academic session
                <input value={academicSession} onChange={(event) => setAcademicSession(event.target.value)} placeholder="2025/2026" required style={{ display: 'block', width: '100%', marginTop: 6, padding: 10 }} />
              </label>
              <label>
                Source examination year (optional)
                <input value={sourceExamYear} onChange={(event) => setSourceExamYear(event.target.value)} placeholder="2025" inputMode="numeric" style={{ display: 'block', width: '100%', marginTop: 6, padding: 10 }} />
              </label>
            </div>
            <label style={{ display: 'block', margin: '16px 0' }}>
              Exam image files
              <input type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" multiple onChange={(event) => addFiles(event.target.files)} style={{ display: 'block', marginTop: 6 }} />
            </label>
            {validationErrors.length > 0 && (
              <ul role="alert" style={{ color: '#b91c1c' }}>
                {validationErrors.map((message, index) => <li key={`${index}-${message}`}>{message}</li>)}
              </ul>
            )}
            {previews.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, margin: '16px 0' }}>
                {previews.map(({ file, url }) => (
                  <figure key={`${file.name}-${file.lastModified}-${file.size}`} style={{ margin: 0, border: '1px solid #e2e8f0', borderRadius: 8, padding: 8 }}>
                    <img src={url} alt={file.name} style={{ width: '100%', height: 110, objectFit: 'cover', borderRadius: 4 }} />
                    <figcaption style={{ fontSize: 12, overflowWrap: 'anywhere', marginTop: 6 }}>{file.name}</figcaption>
                    <button type="button" onClick={() => removeFile(file)} style={{ marginTop: 8 }}>Remove</button>
                  </figure>
                ))}
              </div>
            )}
            {uploading && (
              <div aria-live="polite" style={{ marginBottom: 12 }}>
                <progress value={uploadProgress} max="100" style={{ width: '100%' }} />
                <span>Uploading {uploadProgress}%</span>
              </div>
            )}
            <button type="submit" disabled={uploading || files.length === 0}>
              {uploading ? 'Uploading and extracting…' : 'Upload images and extract drafts'}
            </button>
          </form>
        )}
      </section>

      <section className="wp-section" style={{ marginBottom: 20 }}>
        <h2>Recent extraction batches</h2>
        {batches.length === 0 ? <p>No extraction batches yet.</p> : (
          <div style={{ display: 'grid', gap: 10 }}>
            {batches.map((batch) => (
              <article key={batch.batchId} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <strong>{batch.status.replaceAll('_', ' ')}</strong>
                  <div>{batch.academicSession} · {batch.imageCount} image(s) · {batch.questionCount} draft(s)</div>
                  {batch.processingRetryAfter && new Date(batch.processingRetryAfter) > new Date() && (
                    <small>Processing lease expires {new Date(batch.processingRetryAfter).toLocaleTimeString()}.</small>
                  )}
                  <small>{new Date(batch.createdAt).toLocaleString()}</small>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button type="button" onClick={() => openBatch(batch.batchId)}>View batch</button>
                  {['uploaded', 'processing', 'extracted', 'partially_failed', 'failed'].includes(batch.status) && (
                    <button type="button" disabled={retryingBatch === batch.batchId} onClick={() => retryBatch(batch)}>
                      {retryingBatch === batch.batchId ? 'Retrying…' : 'Retry unfinished work'}
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {selectedBatch && (
        <section className="wp-section">
          <h2>Batch details</h2>
          <p>Status: <strong>{selectedBatch.status.replaceAll('_', ' ')}</strong> · review: <strong>{selectedBatch.reviewStatus || 'pending'}</strong> · {selectedBatch.images?.length || 0} image(s) · {selectedBatch.drafts?.length || 0} draft(s)</p>
          {(selectedBatch.processingErrors || []).map((entry, index) => (
            <p key={`${entry.stage}-${index}`} role="status" style={{ color: '#b45309' }}>{entry.message}</p>
          ))}
          {protectedPreviews.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
              {protectedPreviews.map(({ image, url }) => (
                <div key={image.id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 8 }}>
                  <a href={url} target="_blank" rel="noreferrer">
                    <img src={url} alt={image.originalName} style={{ width: '100%', height: 110, objectFit: 'contain' }} />
                  </a>
                  <div>{image.originalName}</div>
                  <small>OCR: {image.ocrStatus}</small>
                </div>
              ))}
            </div>
          )}
          {(selectedBatch.drafts || []).some((draft) => draft.reviewStatus === 'pending') && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', margin: '18px 0' }}>
              <button type="button" disabled={reviewing || selectedDraftIds.length === 0} onClick={() => reviewSelected('approve')}>Approve selected</button>
              <button type="button" disabled={reviewing || selectedDraftIds.length === 0} onClick={() => reviewSelected('reject')}>Reject selected</button>
              <button type="button" onClick={() => setSelectedDraftIds(
                selectedDraftIds.length === selectedBatch.drafts.filter((draft) => draft.reviewStatus === 'pending').length
                  ? []
                  : selectedBatch.drafts.filter((draft) => draft.reviewStatus === 'pending').map((draft) => draft._id)
              )}>Select all pending</button>
            </div>
          )}
          {selectedBatch.drafts?.map((draft, index) => {
            const form = draftForms[draft._id] || toDraftForm(draft);
            const sourceImage = selectedBatch.images?.find((image) => image.id === String(draft.sourceImage));
            const editable = draft.reviewStatus === 'pending';
            return (
              <article key={draft._id || index} style={{ borderTop: '1px solid #e2e8f0', marginTop: 16, paddingTop: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
                  <h3 style={{ margin: 0 }}>{draft.questionNumber ? `Question ${draft.questionNumber}` : `Draft ${index + 1}`}</h3>
                  <strong aria-label="Review status" style={{ textTransform: 'capitalize' }}>{draft.reviewStatus || 'pending'}</strong>
                </div>
                {editable && <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', margin: '12px 0' }}>
                  <input type="checkbox" checked={selectedDraftIds.includes(draft._id)} onChange={(event) => {
                    setSelectedDraftIds((current) => event.target.checked
                      ? [...current, draft._id]
                      : current.filter((id) => id !== draft._id));
                  }} />
                  Select for batch review
                </label>}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 16, marginTop: 12 }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: 8 }}>
                      Question number
                      <input value={form.questionNumber} readOnly={!editable} onChange={(event) => updateDraftForm(draft._id, (current) => ({ ...current, questionNumber: event.target.value }))} style={{ display: 'block', width: '100%', marginTop: 4 }} />
                    </label>
                    <label style={{ display: 'block', marginBottom: 8 }}>
                      Question text
                      <textarea rows="4" value={form.questionText} readOnly={!editable} onChange={(event) => updateDraftForm(draft._id, (current) => ({ ...current, questionText: event.target.value, confirmCorrectAnswer: false }))} style={{ display: 'block', width: '100%', marginTop: 4 }} />
                    </label>
                    <fieldset style={{ padding: 12, margin: '12px 0' }}>
                      <legend>Answer options</legend>
                      {form.options.map((option, optionIndex) => (
                        <div key={option.optionId || optionIndex} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                          <strong>{String.fromCharCode(65 + optionIndex)}.</strong>
                          <input aria-label={`Option ${String.fromCharCode(65 + optionIndex)}`} value={option.text} readOnly={!editable} onChange={(event) => updateDraftForm(draft._id, (current) => ({
                            ...current,
                            confirmCorrectAnswer: false,
                            options: current.options.map((item, itemIndex) => itemIndex === optionIndex ? { ...item, text: event.target.value } : item)
                          }))} style={{ flex: 1, minWidth: 0 }} />
                          {editable && <button type="button" disabled={form.options.length <= 2} onClick={() => updateDraftForm(draft._id, (current) => ({
                            ...current,
                            confirmCorrectAnswer: false,
                            options: current.options.filter((_, itemIndex) => itemIndex !== optionIndex),
                            confirmedAnswerOptionId: current.confirmedAnswerOptionId === option.optionId ? '' : current.confirmedAnswerOptionId
                          }))}>Remove</button>}
                          {editable && <button type="button" disabled={optionIndex === 0} aria-label={`Move option ${optionIndex + 1} up`} onClick={() => updateDraftForm(draft._id, (current) => {
                            const options = [...current.options];
                            [options[optionIndex - 1], options[optionIndex]] = [options[optionIndex], options[optionIndex - 1]];
                            return { ...current, options, confirmCorrectAnswer: false };
                          })}>↑</button>}
                          {editable && <button type="button" disabled={optionIndex === form.options.length - 1} aria-label={`Move option ${optionIndex + 1} down`} onClick={() => updateDraftForm(draft._id, (current) => {
                            const options = [...current.options];
                            [options[optionIndex], options[optionIndex + 1]] = [options[optionIndex + 1], options[optionIndex]];
                            return { ...current, options, confirmCorrectAnswer: false };
                          })}>↓</button>}
                        </div>
                      ))}
                      {editable && <button type="button" disabled={form.options.length >= 8} onClick={() => updateDraftForm(draft._id, (current) => ({
                        ...current,
                        confirmCorrectAnswer: false,
                        options: [...current.options, { optionId: '', text: '' }]
                      }))}>Add option</button>}
                    </fieldset>
                    <label style={{ display: 'block', marginBottom: 8 }}>
                      Correct answer (AI suggestion is not selected)
                      <select value={form.confirmedAnswerOptionId} disabled={!editable} onChange={(event) => updateDraftForm(draft._id, (current) => ({
                        ...current,
                        confirmedAnswerOptionId: event.target.value,
                        confirmCorrectAnswer: false
                      }))} style={{ display: 'block', width: '100%', marginTop: 4 }}>
                        <option value="">Select the correct answer</option>
                        {form.options.filter((option) => option.optionId).map((option, optionIndex) => (
                          <option key={option.optionId} value={option.optionId}>{String.fromCharCode(65 + optionIndex)}. {option.text}</option>
                        ))}
                      </select>
                    </label>
                    {editable && <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0' }}>
                      <input type="checkbox" checked={form.confirmCorrectAnswer} disabled={!form.confirmedAnswerOptionId} onChange={(event) => updateDraftForm(draft._id, (current) => ({ ...current, confirmCorrectAnswer: event.target.checked }))} />
                      I reviewed and explicitly confirm this correct answer
                    </label>}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
                      <label>Topic<input value={form.topic} readOnly={!editable} onChange={(event) => updateDraftForm(draft._id, (current) => ({ ...current, topic: event.target.value }))} style={{ display: 'block', width: '100%' }} /></label>
                      <label>Difficulty<select value={form.difficulty} disabled={!editable} onChange={(event) => updateDraftForm(draft._id, (current) => ({ ...current, difficulty: event.target.value }))} style={{ display: 'block', width: '100%' }}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></label>
                      <label>Marks<input type="number" min="0.1" max="100" step="0.1" value={form.marks} readOnly={!editable} onChange={(event) => updateDraftForm(draft._id, (current) => ({ ...current, marks: event.target.value }))} style={{ display: 'block', width: '100%' }} /></label>
                    </div>
                    <label style={{ display: 'block', marginTop: 8 }}>
                      Explanation
                      <textarea rows="3" value={form.explanation} readOnly={!editable} onChange={(event) => updateDraftForm(draft._id, (current) => ({ ...current, explanation: event.target.value }))} style={{ display: 'block', width: '100%', marginTop: 4 }} />
                    </label>
                  </div>
                  <aside>
                    <h4 style={{ marginTop: 0 }}>Source and extraction confidence</h4>
                    {sourceImage ? (
                      <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 8, marginBottom: 10 }}>
                        {protectedPreviews.filter(({ image }) => image.id === sourceImage.id).map(({ image, url }) => (
                          <a key={image.id} href={url} target="_blank" rel="noreferrer">
                            <img src={url} alt={`Original source for draft ${index + 1}: ${image.originalName}`} style={{ width: '100%', maxHeight: 320, objectFit: 'contain' }} />
                          </a>
                        ))}
                        <div>{sourceImage.originalName}</div>
                      </div>
                    ) : <p>Source image reference unavailable.</p>}
                    <p>OCR confidence: {draft.ocrConfidence == null ? 'not reported' : `${draft.ocrConfidence}%`}</p>
                    <p>Structuring confidence: {draft.structuringConfidence == null ? 'not reported' : `${Math.round(draft.structuringConfidence * 100)}%`}</p>
                    <p>AI-suggested answer (unconfirmed): {draft.possibleAnswer || 'none'}</p>
                    {draft.extractionWarnings?.map((warning, warningIndex) => <p key={`${warningIndex}-${warning}`} style={{ color: '#b45309' }}>Warning: {warning}</p>)}
                    {draft.reviewStatus !== 'pending' && <>
                      <p>Reviewed {draft.reviewedAt ? new Date(draft.reviewedAt).toLocaleString() : ''}</p>
                      {draft.reviewer && <p>Reviewer: {String(draft.reviewer)}</p>}
                      {draft.approvedQuestion && <p>Question ID: {String(draft.approvedQuestion)}</p>}
                      {draft.rejectionReason && <p>Rejection reason: {draft.rejectionReason}</p>}
                    </>}
                    {editable && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                      <button type="button" disabled={reviewing} onClick={async () => {
                        try {
                          setReviewError('');
                          setReviewMessage('');
                          await saveDraft(draft._id);
                        } catch (requestError) {
                          setReviewError(requestError.message || 'Unable to save draft corrections.');
                        }
                      }}>Save corrections</button>
                      <button type="button" disabled={reviewing} onClick={() => approveDraft(draft._id)}>Review and approve</button>
                      <button type="button" disabled={reviewing} onClick={() => rejectDraft(draft._id)}>Reject</button>
                    </div>}
                  </aside>
                </div>
                {(draft.reviewHistory || []).length > 0 && (
                  <details style={{ marginTop: 12 }}>
                    <summary>Review history ({draft.reviewHistory.length})</summary>
                    <ol>
                      {draft.reviewHistory.map((entry, historyIndex) => (
                        <li key={`${entry.reviewedAt}-${historyIndex}`}>
                          {entry.action} by {String(entry.reviewer)} · {entry.reviewedAt ? new Date(entry.reviewedAt).toLocaleString() : ''}
                          {entry.rejectionReason ? ` · ${entry.rejectionReason}` : ''}
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
                {draft.originalContent && (
                  <details style={{ marginTop: 8 }}>
                    <summary>Original extracted content (provenance)</summary>
                    <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(draft.originalContent, null, 2)}</pre>
                  </details>
                )}
              </article>
            );
          })}
          {selectedBatch.ocrText && (
            <details style={{ marginTop: 16 }}>
              <summary>Saved OCR text</summary>
              <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{selectedBatch.ocrText}</pre>
            </details>
          )}
        </section>
      )}
    </main>
  );
}
