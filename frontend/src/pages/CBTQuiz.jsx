import React, { useEffect, useState } from 'react'
import { apiGet, apiPost } from '../utils/api'
import { useAuth } from '../utils/auth'
import PremiumGate from '../components/PremiumGate'

export default function CBTQuiz() {
  const { user } = useAuth()
  const [courses, setCourses] = useState([])
  const [questions, setQuestions] = useState([])
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState([])
  const [score, setScore] = useState(0)
  const [finished, setFinished] = useState(false)
  const [courseId, setCourseId] = useState('')
  const [startTime, setStartTime] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(()=>{
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

  async function startQuiz(){
    if(!courseId) return alert('Select a course')
    setLoading(true)
    try{
      let res
      if(user && user._id){
        res = await apiPost('/api/quiz/start', { userId: user._id, courseId })
      } else {
        res = await apiGet(`/api/questions/quiz/${courseId}`)
      }

      const loadedQuestions = res.questions || []
      if (loadedQuestions.length === 0) {
        return alert('No objective past questions available for this course yet. Please add multiple-choice past questions for the selected course.')
      }

      setQuestions(loadedQuestions)
      setStartTime(res.startedAt || new Date())
      setIndex(0)
      setScore(0)
      setFinished(false)
      setAnswers([])
    }catch(err){
      console.error(err)
      alert('Failed to start quiz: '+(err.message||''))
    } finally {
      setLoading(false)
    }
  }

  const q = questions[index]

  const selectAnswer = (optionIndex) => {
    setAnswers(prev => {
      const next = [...prev]
      next[index] = optionIndex
      return next
    })
  }

  const submit = async () => {
    if (answers[index] == null) return alert('Select an option')
    const selected = answers[index]
    const isCorrect = selected === q.answer
    if (isCorrect) setScore(s=>s+1)

    if (index + 1 < questions.length) {
      setIndex(i=>i+1)
    } else {
      setFinished(true)
      if(user && user._id){
        const payload = {
          userId: user._id,
          courseId,
          answers: questions.map((ques, i) => ({ questionId: ques._id, selectedAnswer: answers[i] })),
          startTime
        }
        try{
          await apiPost('/api/quiz/submit', payload)
        }catch(err){
          console.warn('Failed to submit quiz session', err)
        }
      }
    }
  }

  if (finished) return (
    <div className="page">
      <h2>Quiz Complete</h2>
      <p>Your score: {score} / {questions.length}</p>
    </div>
  )

  return (
    <PremiumGate fallback={<p>Upgrade to premium to access the CBT quiz engine.</p>}>
      <div className="page">
        <h2>CBT Quiz</h2>
        <div className="card">
          <p className="text-sm text-gray-600 mb-3">Quiz questions are automatically generated from objective past questions uploaded for the selected course.</p>
          <select value={courseId} onChange={e=>setCourseId(e.target.value)}>
            <option value="">Select a course</option>
            {courses.map(course => (
              <option key={course._id} value={course._id}>
                {course.title} ({course.code})
              </option>
            ))}
          </select>
          <button onClick={startQuiz} disabled={!courseId || loading}>{loading ? 'Starting...' : 'Start Quiz'}</button>
        </div>

        {q && (
          <div className="card">
            <p className="question-text">{q.question || q.text}</p>
            <div className="options">
              {(q.options || q.choices || []).map((opt, i) => (
                <label key={i} className={`option ${answers[index]===i ? 'selected' : ''}`}>
                  <input type="radio" name="opt" checked={answers[index]===i} onChange={()=>selectAnswer(i)} /> {opt}
                </label>
              ))}
            </div>
            <button onClick={submit}>Submit</button>
          </div>
        )}
      </div>
    </PremiumGate>
  )
}
