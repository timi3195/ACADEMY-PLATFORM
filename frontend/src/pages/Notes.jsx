import React, { useEffect, useState } from 'react'
import { apiGet, apiPost } from '../utils/api'

export default function Notes() {
  const [notes, setNotes] = useState([])
  const [courses, setCourses] = useState([])
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [courseId, setCourseId] = useState('')

  useEffect(()=>{
    fetchNotes()
    fetchCourses()
  }, [])

  async function fetchCourses(){
    try{
      const res = await apiGet('/api/courses')
      setCourses(res.courses || [])
    }catch(err){
      console.error(err)
      alert('Failed to load courses')
    }
  }

  async function fetchNotes(){
    try{
      const res = await apiGet('/api/notes')
      setNotes(res.notes || [])
    }catch(err){
      console.error(err)
      alert('Failed to load notes')
    }
  }

  async function add(){
    if(!title || !content || !courseId) return alert('Provide title, content and course')
    try{
      const res = await apiPost('/api/notes', { title, content, course: courseId, isPremium: false })
      if(res && res.note){
        setNotes(prev => [res.note, ...prev])
        setTitle(''); setContent(''); setCourseId('')
      }
    }catch(err){
      console.error(err)
      alert('Failed to create note: ' + (err.message||''))
    }
  }

  return (
    <div className="page">
      <h2>Notes</h2>
      <div className="card">
        <input placeholder="Title" value={title} onChange={e=>setTitle(e.target.value)} />
        <textarea value={content} onChange={e=>setContent(e.target.value)} placeholder="Content" />
        <select value={courseId} onChange={e => setCourseId(e.target.value)}>
          <option value="">Select a course</option>
          {courses.map(course => (
            <option key={course._id} value={course._id}>
              {course.title} ({course.code})
            </option>
          ))}
        </select>
        <button onClick={add}>Add Note</button>
      </div>
      <div>
        {notes.map(n => (
          <div className="note" key={n._id || n.id}>
            <strong>{n.title}</strong>
            <div>{n.content}</div>
            {n.course && <div className="meta">Course: {n.course.title || n.course}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}
