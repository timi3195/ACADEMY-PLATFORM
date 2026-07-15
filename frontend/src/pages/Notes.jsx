import React, { useEffect, useState } from 'react'
import { apiGet, apiPost } from '../utils/api'
import EmptyState from '../components/EmptyState'
import ErrorState from '../components/ErrorState'

export default function Notes() {
  const [notes, setNotes] = useState([])
  const [courses, setCourses] = useState([])
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [courseId, setCourseId] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const [notesRes, coursesRes] = await Promise.all([
        apiGet('/api/notes'),
        apiGet('/api/courses')
      ])
      setNotes(notesRes.notes || [])
      setCourses(coursesRes.courses || [])
    } catch (err) {
      console.error(err)
      setError(err.message || 'Unable to load your notes right now.')
    } finally {
      setLoading(false)
    }
  }

  async function add() {
    if (!title.trim() || !content.trim() || !courseId) {
      setError('Please provide a title, content, and course before saving your note.')
      return
    }

    setError('')
    setSuccess('')
    setSubmitting(true)
    try {
      const res = await apiPost('/api/notes', { title: title.trim(), content: content.trim(), course: courseId, isPremium: false })
      if (res && res.note) {
        setNotes(prev => [res.note, ...prev])
        setTitle('')
        setContent('')
        setCourseId('')
        setSuccess('Note saved successfully.')
      }
    } catch (err) {
      console.error(err)
      setError(err.message || 'Unable to save your note.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="page">
      <h2>Notes</h2>
      <p className="text-sm text-gray-600 mb-4">Capture quick study reminders and keep them tied to a course.</p>
      <div className="card">
        {error && <ErrorState message={error} />}
        {success && <div className="success-banner" style={{ marginBottom: '12px' }}>{success}</div>}
        <input placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} />
        <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="Content" />
        <select value={courseId} onChange={e => setCourseId(e.target.value)}>
          <option value="">Select a course</option>
          {courses.map(course => (
            <option key={course._id} value={course._id}>
              {course.title} ({course.code})
            </option>
          ))}
        </select>
        <button onClick={add} disabled={submitting}>{submitting ? 'Saving...' : 'Add Note'}</button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-600">Loading notes…</p>
      ) : notes.length === 0 ? (
        <EmptyState title="No notes yet" description="Create your first note and it will appear here for easy review later." icon="📝" />
      ) : (
        <div>
          {notes.map(n => (
            <div className="note" key={n._id || n.id}>
              <strong>{n.title}</strong>
              <div>{n.content}</div>
              {n.course && <div className="meta">Course: {n.course.title || n.course}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
