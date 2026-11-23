import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { apiDelete, apiGet, apiPost, apiPut } from '../utils/api'

const currentYear = () => String(new Date().getFullYear())
const courseIdOf = (course) => String(course?._id || course || '')
const paperIdOf = (paper) => String(paper?._id || paper || '')
const emptyQuestion = (course = '', year = currentYear()) => ({
  course,
  topic: '',
  questionNumber: '',
  question: '',
  questionType: 'objective',
  options: ['', '', '', ''],
  answer: '',
  explanation: '',
  blankCount: 1,
  year,
  session: 'Rain',
  marks: 2,
  difficulty: 'medium',
  questionOrigin: 'verified_past_paper',
  approvalStatus: 'draft',
  sourcePaperId: '',
  batchId: '',
  sourcePage: '',
  sourceExcerpt: ''
})

export const validateManualQuestion = (
  form,
  status,
  sourceYear,
  hasSourcePaper = Boolean(form.sourcePaperId)
) => {
  const errors = []
  const questionOrigin = form.questionOrigin || 'verified_past_paper'
  if (!form.course) errors.push('Select a course.')
  if (!form.topic.trim()) errors.push('Enter a topic.')
  if (!form.question.trim()) errors.push('Enter the question text.')
  if (!/^\d{4}$/.test(form.year.trim())) errors.push('Enter a four-digit examination year.')
  if (questionOrigin === 'verified_past_paper' && sourceYear && form.year.trim() !== String(sourceYear)) {
    errors.push('The examination year must match the linked source paper.')
  }
  if (!Number.isFinite(Number(form.marks)) || Number(form.marks) <= 0 || Number(form.marks) > 100) {
    errors.push('Marks must be greater than 0 and no more than 100.')
  }
  if (status !== 'approved') return errors

  if (form.questionType === 'objective') {
    const options = form.options.map((option) => option.trim()).filter(Boolean)
    if (options.length < 2) errors.push('Add at least 2 answer options before publishing.')
    if (!form.answer || !options.includes(form.answer)) {
      errors.push('Choose a correct answer from the answer options before publishing.')
    }
  } else if (form.questionType === 'fill_in_gap') {
    const count = Number(form.blankCount)
    if (!Number.isInteger(count) || count < 1 || count > 20) {
      errors.push('Enter between 1 and 20 blanks before publishing.')
    }
    if (!form.answer.trim()) errors.push('Enter a correct answer before publishing.')
  }
  if (questionOrigin === 'verified_past_paper' && !hasSourcePaper) {
    errors.push('Select an uploaded source paper before publishing.')
  }
  if (questionOrigin === 'original_practice' &&
      (form.sourcePaperId || form.batchId || form.sourcePage || form.sourceExcerpt)) {
    errors.push('Original practice questions cannot include past-paper provenance.')
  }
  return errors
}

const questionToForm = (question) => ({
  ...emptyQuestion(courseIdOf(question.course), String(question.year || currentYear())),
  topic: question.topic || '',
  questionNumber: question.questionNumber || '',
  question: question.question || '',
  questionType: question.questionType || 'objective',
  options: question.options?.length ? [...question.options] : ['', '', '', ''],
  answer: question.answer || '',
  explanation: question.explanation || '',
  blankCount: question.blankCount ?? 1,
  session: question.session || 'Rain',
  marks: question.marks ?? 2,
  difficulty: question.difficulty || 'medium',
  questionOrigin: question.questionOrigin || 'verified_past_paper',
  approvalStatus: question.approvalStatus || 'draft',
  sourcePaperId: paperIdOf(question.sourcePaper),
  batchId: question.extractionBatchId || '',
  sourcePage: question.sourcePage || '',
  sourceExcerpt: question.sourceExcerpt || ''
})

const getBatchYear = (batch) =>
  String(batch?.sourceExamYear || batch?.academicSession || '').slice(0, 4) || currentYear()

export default function ManualQuestionEditor() {
  const { questionId } = useParams()
  const [searchParams] = useSearchParams()
  const requestedBatchId = searchParams.get('batchId') || ''
  const [questions, setQuestions] = useState([])
  const [courses, setCourses] = useState([])
  const [papers, setPapers] = useState([])
  const [batch, setBatch] = useState(null)
  const [form, setForm] = useState(() => emptyQuestion())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [validationErrors, setValidationErrors] = useState([])
  const [showPreview, setShowPreview] = useState(false)

  const refreshQuestions = useCallback(async () => {
    const response = await apiGet('/api/questions?all=true')
    setQuestions(response.questions || [])
  }, [])

  useEffect(() => {
    let active = true
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const [questionList, courseResponse, editedQuestion] = await Promise.all([
          apiGet('/api/questions?all=true'),
          apiGet('/api/question-extractions/courses'),
          questionId ? apiGet(`/api/questions/${encodeURIComponent(questionId)}`) : Promise.resolve(null)
        ])
        if (!active) return
        setQuestions(questionList.questions || [])
        setCourses(courseResponse.courses || [])
        if (editedQuestion?.question) {
          setForm(questionToForm(editedQuestion.question))
        } else if (requestedBatchId) {
          setForm(emptyQuestion('', currentYear()))
        }
      } catch (requestError) {
        if (active) setError(requestError.message || 'Unable to load the manual question editor.')
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [questionId, requestedBatchId])

  useEffect(() => {
    if (!requestedBatchId) {
      setBatch(null)
      return undefined
    }
    let active = true
    apiGet(`/api/question-extractions/${encodeURIComponent(requestedBatchId)}`)
      .then((response) => {
        if (!active) return
        const nextBatch = response.batch
        setBatch(nextBatch)
        setForm((current) => ({
          ...current,
          course: courseIdOf(nextBatch.course),
          year: getBatchYear(nextBatch),
          batchId: nextBatch.batchId,
          sourcePaperId: paperIdOf(nextBatch.sourcePaper)
        }))
      })
      .catch((requestError) => {
        if (active) setError(requestError.message || 'Unable to load the extraction batch.')
      })
    return () => { active = false }
  }, [requestedBatchId])

  useEffect(() => {
    if (!form.course || batch || form.batchId) {
      setPapers([])
      return undefined
    }
    let active = true
    apiGet(`/api/question-extractions/source-papers?courseId=${encodeURIComponent(form.course)}`)
      .then((response) => {
        if (active) setPapers(response.papers || [])
      })
      .catch((requestError) => {
        if (active) setError(requestError.message || 'Unable to load source papers.')
      })
    return () => { active = false }
  }, [form.course, form.batchId, batch])

  useEffect(() => {
    if (!questionId || !form.batchId) return undefined
    let active = true
    apiGet(`/api/question-extractions/${encodeURIComponent(form.batchId)}`)
      .then((response) => { if (active) setBatch(response.batch) })
      .catch((requestError) => {
        if (active) setError(requestError.message || 'Unable to load the linked extraction batch.')
      })
    return () => { active = false }
  }, [questionId, form.batchId])

  const selectedCourse = useMemo(
    () => courses.find((course) => String(course._id) === String(form.course)),
    [courses, form.course]
  )

  const updateForm = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }))
    setNotice('')
    setError('')
  }

  const addOption = () => updateForm('options', [...form.options, ''])
  const updateOption = (index, value) => {
    const options = form.options.map((option, optionIndex) => optionIndex === index ? value : option)
    setForm((current) => ({
      ...current,
      options,
      answer: options.includes(current.answer) ? current.answer : ''
    }))
    setNotice('')
  }
  const removeOption = (index) => {
    const options = form.options.filter((_, optionIndex) => optionIndex !== index)
    setForm((current) => ({
      ...current,
      options,
      answer: options.includes(current.answer) ? current.answer : ''
    }))
    setNotice('')
  }

  const saveQuestion = async (event, status) => {
    event.preventDefault()
    setNotice('')
    setError('')
    const selectedPaper = form.questionOrigin === 'verified_past_paper'
      ? papers.find((paper) => String(paper._id) === String(form.sourcePaperId))
      : null
    const sourceYear = form.questionOrigin === 'verified_past_paper'
      ? batch?.sourceExamYear || batch?.sourcePaperMetadata?.examinationYear || selectedPaper?.examinationYear
      : null
    const errors = validateManualQuestion(
      form,
      status,
      sourceYear,
      Boolean(form.sourcePaperId || batch?.sourcePaper)
    )
    setValidationErrors(errors)
    if (errors.length) return

    const payload = {
      ...form,
      questionOrigin: form.questionOrigin || 'verified_past_paper',
      approvalStatus: status,
      options: form.questionType === 'objective'
        ? form.options.map((option) => option.trim()).filter(Boolean)
        : [],
      sourcePage: form.sourcePage === '' ? null : Number(form.sourcePage),
      sourceExcerpt: form.sourceExcerpt.slice(0, 5000)
    }
    try {
      setSaving(true)
      const response = questionId
        ? await apiPut(`/api/questions/${encodeURIComponent(questionId)}`, payload)
        : await apiPost('/api/questions', payload)
      if (!response.question) throw new Error('The server did not return the saved question.')
      setNotice(status === 'approved'
        ? response.markingStatus === 'ready'
          ? 'Question published and CBT marking is ready.'
          : `Question published, but CBT marking is ${response.markingStatus || 'not ready'}. It will not be available for CBT until marking is ready.`
        : 'Question saved as a draft.')
      setValidationErrors([])
      if (questionId) {
        setForm(questionToForm(response.question))
      } else {
        setForm((current) => ({
          ...emptyQuestion(current.course, current.year),
          questionOrigin: current.questionOrigin || 'verified_past_paper',
          sourcePaperId: current.questionOrigin === 'original_practice' ? '' : current.sourcePaperId,
          batchId: current.questionOrigin === 'original_practice' ? '' : current.batchId,
          sourceExcerpt: ''
        }))
      }
      await refreshQuestions()
    } catch (requestError) {
      setError(requestError.message || 'Unable to save the question.')
    } finally {
      setSaving(false)
    }
  }

  const deleteQuestion = async (question) => {
    if (!window.confirm('Delete this question? Only unused draft questions can be deleted.')) return
    setError('')
    setNotice('')
    try {
      await apiDelete(`/api/questions/${encodeURIComponent(question._id)}`)
      setNotice('Question deleted.')
      await refreshQuestions()
    } catch (requestError) {
      setError(requestError.message || 'Unable to delete the question.')
    }
  }

  const copyOcrText = () => {
    if (!batch?.ocrText) return
    const text = batch.ocrText.slice(0, 5000)
    setForm((current) => ({ ...current, question: text, sourceExcerpt: text }))
    setNotice(batch.ocrText.length > 5000
      ? 'The first 5,000 characters of saved OCR text were copied. Edit it into a question before saving.'
      : 'Saved OCR text copied into the editor. Edit it into a question before saving.')
  }

  const startAnotherQuestion = () => {
    setForm((current) => ({
      ...emptyQuestion(current.course, current.year),
      questionOrigin: current.questionOrigin || 'verified_past_paper',
      sourcePaperId: current.questionOrigin === 'original_practice' ? '' : current.sourcePaperId,
      batchId: current.questionOrigin === 'original_practice' ? '' : current.batchId
    }))
    setValidationErrors([])
    setError('')
    setNotice('')
    setShowPreview(false)
  }

  if (loading) return <main className="page"><section className="wp-section">Loading manual question editor…</section></main>

  return (
    <main className="page">
      <section className="wp-section" style={{ marginBottom: 20 }}>
        <Link to="/admin" style={{ color: '#2563eb' }}>← Administration</Link>
        <h1>{questionId ? 'Edit question' : 'Manual question entry'}</h1>
        <p>Enter questions directly. OCR and Gemini are optional and are not needed to save or publish a question.</p>
        <Link to="/admin/question-extractions">Open extraction batches</Link>
        {batch && (
          <p role="status">
            Linked batch: {batch.sourcePaperMetadata?.title || 'Uploaded question images'} · {batch.academicLevel}, {batch.semester} · source year {batch.sourceExamYear || 'not specified'}
          </p>
        )}
      </section>

      {error && <div role="alert" className="wp-section" style={{ color: '#b91c1c', marginBottom: 16 }}>{error}</div>}
      {notice && <div role="status" className="wp-section" style={{ color: '#166534', marginBottom: 16 }}>{notice}</div>}

      {batch?.ocrText && (
        <details className="wp-section" style={{ marginBottom: 16 }}>
          <summary>Saved OCR text (retained on the extraction batch)</summary>
          <button type="button" onClick={copyOcrText} style={{ margin: '12px 0' }}>Copy saved OCR text into question</button>
          <pre style={{ maxHeight: 320, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{batch.ocrText}</pre>
        </details>
      )}

      <section className="wp-section" style={{ marginBottom: 20 }}>
        <h2>{questionId ? 'Question details' : 'Add a question'}</h2>
        <form onSubmit={(event) => saveQuestion(event, form.approvalStatus)} noValidate>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <label>
              Subject / course
              <select
                value={form.course}
                onChange={(event) => {
                  setForm((current) => ({
                    ...current,
                    course: event.target.value,
                    sourcePaperId: ''
                  }))
                  setNotice('')
                  setError('')
                }}
                required
                disabled={Boolean(batch || form.batchId)}
                style={{ display: 'block', width: '100%', marginTop: 6, padding: 10 }}
              >
                <option value="">Select a course</option>
                {courses.map((course) => (
                  <option key={course._id} value={course._id}>{course.code} — {course.title}</option>
                ))}
              </select>
            </label>
            <label>
              Topic
              <input value={form.topic} onChange={(event) => updateForm('topic', event.target.value)} required maxLength={160} style={{ display: 'block', width: '100%', marginTop: 6, padding: 10 }} />
            </label>
            <label>
              Question number / order
              <input value={form.questionNumber} onChange={(event) => updateForm('questionNumber', event.target.value)} maxLength={32} placeholder="e.g. 1(a)" style={{ display: 'block', width: '100%', marginTop: 6, padding: 10 }} />
            </label>
          </div>

          <label style={{ display: 'block', margin: '14px 0' }}>
            Question text
            <textarea value={form.question} onChange={(event) => updateForm('question', event.target.value)} required maxLength={5000} rows={4} style={{ display: 'block', width: '100%', marginTop: 6, padding: 10 }} />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <label>
              Question type
              <select value={form.questionType} onChange={(event) => updateForm('questionType', event.target.value)} style={{ display: 'block', width: '100%', marginTop: 6, padding: 10 }}>
                <option value="objective">Multiple choice</option>
                <option value="fill_in_gap">Fill in the gap</option>
                <option value="theory">Theory / essay</option>
              </select>
            </label>
            <label>
              Question origin
              <select
                aria-label="Question origin"
                value={form.questionOrigin || 'verified_past_paper'}
                onChange={(event) => {
                  const questionOrigin = event.target.value
                  setForm((current) => ({
                    ...current,
                    questionOrigin,
                    ...(questionOrigin === 'original_practice'
                      ? { sourcePaperId: '', batchId: '', sourcePage: '', sourceExcerpt: '' }
                      : {})
                  }))
                  setNotice('')
                  setError('')
                }}
                disabled={Boolean(batch || form.batchId)}
                style={{ display: 'block', width: '100%', marginTop: 6, padding: 10 }}
              >
                <option value="verified_past_paper">Verified past-paper question</option>
                <option value="original_practice">Original practice question</option>
              </select>
            </label>
            <label>
              Exam year
              <input value={form.year} onChange={(event) => updateForm('year', event.target.value)} inputMode="numeric" maxLength={4} required style={{ display: 'block', width: '100%', marginTop: 6, padding: 10 }} />
            </label>
            <label>
              Examination session
              <select value={form.session} onChange={(event) => updateForm('session', event.target.value)} style={{ display: 'block', width: '100%', marginTop: 6, padding: 10 }}>
                <option value="Rain">Rain</option>
                <option value="Harmattan">Harmattan</option>
              </select>
            </label>
            <label>
              Marks
              <input type="number" min="0.1" max="100" step="0.1" value={form.marks} onChange={(event) => updateForm('marks', event.target.value)} required style={{ display: 'block', width: '100%', marginTop: 6, padding: 10 }} />
            </label>
            <label>
              Difficulty
              <select value={form.difficulty} onChange={(event) => updateForm('difficulty', event.target.value)} style={{ display: 'block', width: '100%', marginTop: 6, padding: 10 }}>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </label>
            {form.questionOrigin !== 'original_practice' && (
              <label>
                Uploaded source paper
                <select
                  value={form.sourcePaperId}
                  onChange={(event) => {
                    const paper = papers.find((item) => String(item._id) === event.target.value)
                    setForm((current) => ({
                      ...current,
                      sourcePaperId: event.target.value,
                      ...(paper ? { year: String(paper.examinationYear) } : {})
                    }))
                    setNotice('')
                    setError('')
                  }}
                  disabled={Boolean(batch || form.batchId)}
                  style={{ display: 'block', width: '100%', marginTop: 6, padding: 10 }}
                >
                  <option value="">No linked paper</option>
                  {papers.map((paper) => (
                    <option key={paper._id} value={paper._id}>{paper.title} ({paper.examinationYear}, {paper.level}, {paper.semester})</option>
                  ))}
                  {form.sourcePaperId && batch?.sourcePaperMetadata && (
                    <option value={form.sourcePaperId}>{batch.sourcePaperMetadata.title}</option>
                  )}
                </select>
              </label>
            )}
          </div>
          {selectedCourse && <p>Academic level: {selectedCourse.level} · semester: {selectedCourse.semester}</p>}

          {form.questionType === 'objective' && (
            <fieldset style={{ margin: '16px 0', padding: 12 }}>
              <legend>Answer options</legend>
              {form.options.map((option, index) => (
                <div key={index} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <label style={{ flex: 1 }}>
                    Option {String.fromCharCode(65 + index)}
                    <input aria-label={`Option ${String.fromCharCode(65 + index)}`} value={option} onChange={(event) => updateOption(index, event.target.value)} maxLength={1000} style={{ display: 'block', width: '100%', marginTop: 4, padding: 8 }} />
                  </label>
                  <button type="button" disabled={form.options.length <= 2} onClick={() => removeOption(index)} aria-label={`Remove option ${String.fromCharCode(65 + index)}`}>Remove</button>
                </div>
              ))}
              <button type="button" disabled={form.options.length >= 8} onClick={addOption}>Add option</button>
              <label style={{ display: 'block', marginTop: 12 }}>
                Correct answer
                <select value={form.answer} onChange={(event) => updateForm('answer', event.target.value)} style={{ display: 'block', width: '100%', marginTop: 6, padding: 10 }}>
                  <option value="">Select the correct answer</option>
                  {form.options.map((option, index) => option.trim() && (
                    <option key={`${index}-${option}`} value={option.trim()}>{String.fromCharCode(65 + index)} — {option.trim()}</option>
                  ))}
                </select>
              </label>
            </fieldset>
          )}

          {form.questionType === 'fill_in_gap' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, margin: '16px 0' }}>
              <label>Number of blanks<input type="number" min="1" max="20" value={form.blankCount} onChange={(event) => updateForm('blankCount', event.target.value)} style={{ display: 'block', width: '100%', marginTop: 6, padding: 10 }} /></label>
              <label>Correct answer(s)<input value={form.answer} onChange={(event) => updateForm('answer', event.target.value)} style={{ display: 'block', width: '100%', marginTop: 6, padding: 10 }} /></label>
            </div>
          )}

          {form.questionType === 'theory' && (
            <label style={{ display: 'block', margin: '16px 0' }}>
              Reference answer (optional)
              <textarea value={form.answer} onChange={(event) => updateForm('answer', event.target.value)} rows={3} style={{ display: 'block', width: '100%', marginTop: 6, padding: 10 }} />
            </label>
          )}

          <label style={{ display: 'block', margin: '14px 0' }}>
            Explanation (optional)
            <textarea value={form.explanation} onChange={(event) => updateForm('explanation', event.target.value)} rows={3} style={{ display: 'block', width: '100%', marginTop: 6, padding: 10 }} />
          </label>
          {form.questionOrigin !== 'original_practice' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <label>Source page (optional)<input type="number" min="1" value={form.sourcePage} onChange={(event) => updateForm('sourcePage', event.target.value)} style={{ display: 'block', width: '100%', marginTop: 6, padding: 10 }} /></label>
              <label>Source excerpt (optional)<textarea value={form.sourceExcerpt} onChange={(event) => updateForm('sourceExcerpt', event.target.value)} maxLength={5000} rows={2} style={{ display: 'block', width: '100%', marginTop: 6, padding: 10 }} /></label>
            </div>
          )}

          {validationErrors.length > 0 && (
            <ul role="alert" style={{ color: '#b91c1c' }}>
              {validationErrors.map((message) => <li key={message}>{message}</li>)}
            </ul>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
            <button type="button" onClick={() => setShowPreview((visible) => !visible)}>{showPreview ? 'Hide preview' : 'Preview question'}</button>
            <button type="button" disabled={saving} onClick={(event) => saveQuestion(event, 'draft')}>{saving ? 'Saving…' : 'Save draft'}</button>
            <button type="button" disabled={saving} onClick={(event) => saveQuestion(event, 'approved')}>{saving ? 'Saving…' : 'Publish question'}</button>
            {!questionId && <button type="button" disabled={saving} onClick={startAnotherQuestion}>Add another question</button>}
          </div>
        </form>

        {showPreview && (
          <article aria-label="Question preview" style={{ marginTop: 18, border: '1px solid #cbd5e1', borderRadius: 8, padding: 16 }}>
            <strong>{form.questionNumber ? `Question ${form.questionNumber}` : 'Question preview'} · {form.marks || 0} mark(s)</strong>
            <p>{form.question || 'Question text will appear here.'}</p>
            {form.questionType === 'objective' && (
              <ol type="A">{form.options.filter((option) => option.trim()).map((option, index) => <li key={`${index}-${option}`}>{option}</li>)}</ol>
            )}
            {form.answer && <p>Correct answer: {form.answer}</p>}
            {form.explanation && <p>Explanation: {form.explanation}</p>}
          </article>
        )}
      </section>

      {!questionId && (
        <section className="wp-section">
          <h2>Question bank</h2>
          {questions.length === 0 ? <p>No recent questions found.</p> : (
            <div style={{ display: 'grid', gap: 10 }}>
              {questions.map((question) => (
                <article key={question._id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    <strong>{question.questionNumber ? `${question.questionNumber}. ` : ''}{question.question}</strong>
                    <span>{question.approvalStatus || 'draft'}</span>
                  </div>
                  <p>{question.course?.code || question.course?.title || 'Course'} · {question.topic} · {question.year} · {question.session}</p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Link to={`/admin/questions/${question._id}/edit`}>Edit</Link>
                    <button type="button" onClick={() => deleteQuestion(question)}>Delete</button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  )
}
