import React, { useEffect, useState } from 'react'
import { useAuth } from '../utils/auth'
import { useNavigate } from 'react-router-dom'
import { apiGet, apiPost } from '../utils/api'

export default function AdminPanel() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('addCourse')
  const [courses, setCourses] = useState([])
  const [departments, setDepartments] = useState([])
  const [materials, setMaterials] = useState([])
  const [questions, setQuestions] = useState([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [selectedCourse, setSelectedCourse] = useState('')
  const [materialTitle, setMaterialTitle] = useState('')
  const [materialFile, setMaterialFile] = useState(null)
  const [materialIsPremium, setMaterialIsPremium] = useState(false)

  const [questionCourse, setQuestionCourse] = useState('')
  const [hasSubQuestions, setHasSubQuestions] = useState(false)
  const [subQuestions, setSubQuestions] = useState([
    {
      label: '1a',
      question: '',
      options: ['', '', '', ''],
      answer: '',
      explanation: '',
      year: new Date().getFullYear().toString(),
      session: 'Rain',
      marks: 2,
      difficulty: 'medium',
      isPremium: false
    }
  ])
  const [questionData, setQuestionData] = useState({
    topic: '',
    question: '',
    options: ['', '', '', ''],
    answer: '',
    explanation: '',
    year: new Date().getFullYear().toString(),
    session: 'Rain',
    marks: 2,
    difficulty: 'medium',
    isPremium: false
  })

  const [courseTitle, setCourseTitle] = useState('')
  const [courseCode, setCourseCode] = useState('')
  const [courseDepartment, setCourseDepartment] = useState('')
  const [courseLevel, setCourseLevel] = useState('ND1')
  const [courseSemester, setCourseSemester] = useState('First')
  const [courseCreditUnits, setCourseCreditUnits] = useState(3)
  const [courseDescription, setCourseDescription] = useState('')
  const [courseIsPremium, setCourseIsPremium] = useState(false)

  const [cbtCourse, setCbtCourse] = useState('')
  const [cbtJson, setCbtJson] = useState('')

  useEffect(() => {
    if (loading) return
    if (!user || user.role !== 'admin') {
      navigate('/login')
      return
    }
    fetchDepartments()
    fetchCourses()
    fetchMaterials()
    fetchQuestions()
  }, [user, loading, navigate])

  const fetchDepartments = async () => {
    try {
      const res = await apiGet('/api/departments')
      setDepartments(res.departments || [])
    } catch (err) {
      console.error('Error fetching departments:', err)
    }
  }

  const fetchCourses = async () => {
    try {
      const res = await apiGet('/api/courses')
      setCourses(res.courses || [])
    } catch (err) {
      console.error('Error fetching courses:', err)
    }
  }

  const fetchMaterials = async () => {
    try {
      const res = await apiGet('/api/files')
      setMaterials(res.files || [])
    } catch (err) {
      console.error('Error fetching materials:', err)
    }
  }

  const fetchQuestions = async () => {
    try {
      const res = await apiGet('/api/questions')
      setQuestions(res.questions || [])
    } catch (err) {
      console.error('Error fetching questions:', err)
    }
  }

  const handleCreateCourse = async (e) => {
    e.preventDefault()
    if (!courseTitle || !courseCode || !courseDepartment) {
      alert('Please fill all required fields')
      return
    }

    try {
      setIsSubmitting(true)
      const payload = {
        title: courseTitle,
        code: courseCode,
        department: courseDepartment,
        level: courseLevel,
        semester: courseSemester,
        creditUnits: Number(courseCreditUnits),
        description: courseDescription,
        isPremium: courseIsPremium
      }

      const res = await apiPost('/api/courses', payload)
      if (res.success) {
        alert('Course created successfully!')
        setCourseTitle('')
        setCourseCode('')
        setCourseDepartment('')
        setCourseLevel('ND1')
        setCourseSemester('First')
        setCourseCreditUnits(3)
        setCourseDescription('')
        setCourseIsPremium(false)
        fetchCourses()
      }
    } catch (err) {
      alert('Error creating course: ' + err.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleUploadMaterial = async (e) => {
    e.preventDefault()
    if (!selectedCourse || !materialTitle || !materialFile) {
      alert('Please fill all fields')
      return
    }

    try {
      setIsSubmitting(true)
      const formData = new FormData()
      formData.append('file', materialFile)
      formData.append('title', materialTitle)
      formData.append('course', selectedCourse)
      formData.append('isPremium', materialIsPremium)

      const res = await apiPost('/api/files/upload', formData)
      if (res.success) {
        alert('Material uploaded successfully!')
        setMaterialTitle('')
        setMaterialFile(null)
        setMaterialIsPremium(false)
        setSelectedCourse('')
        fetchMaterials()
      }
    } catch (err) {
      alert('Error uploading material: ' + err.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleAddQuestion = async (e) => {
    e.preventDefault()
    if (!questionCourse || !questionData.topic || !questionData.question) {
      alert('Please fill required fields')
      return
    }

    if (hasSubQuestions) {
      const invalidSub = subQuestions.find((sub) => !sub.question || !sub.answer || sub.options.filter((opt) => opt.trim() !== '').length < 2)
      if (invalidSub) {
        alert('Each sub-question must include a question, at least 2 options, and an answer.')
        return
      }
    } else {
      if (questionData.options.filter((opt) => opt.trim() !== '').length < 2 || !questionData.answer.trim()) {
        alert('Please provide at least 2 options and a correct answer for the main question.')
        return
      }
    }

    try {
      setIsSubmitting(true)
      const payload = {
        topic: questionData.topic,
        question: questionData.question,
        options: hasSubQuestions ? [] : questionData.options,
        answer: hasSubQuestions ? '' : questionData.answer,
        explanation: questionData.explanation,
        year: questionData.year,
        session: questionData.session,
        marks: questionData.marks,
        difficulty: questionData.difficulty,
        isPremium: questionData.isPremium,
        subQuestions: hasSubQuestions ? subQuestions.map((sub) => ({
          label: sub.label,
          question: sub.question,
          options: sub.options,
          answer: sub.answer,
          explanation: sub.explanation,
          year: sub.year,
          session: sub.session,
          marks: sub.marks,
          difficulty: sub.difficulty,
          isPremium: sub.isPremium
        })) : [],
        course: questionCourse,
        department: courses.find(c => c._id === questionCourse)?.department?._id || ''
      }

      const res = await apiPost('/api/questions', payload)
      if (res.success) {
        alert('Question added successfully!')
        setQuestionData({
          topic: '',
          question: '',
          options: ['', '', '', ''],
          answer: '',
          explanation: '',
          year: new Date().getFullYear().toString(),
          session: 'Rain',
          marks: 2,
          difficulty: 'medium',
          isPremium: false
        })
        setQuestionCourse('')
        setHasSubQuestions(false)
        setSubQuestions([
          {
            label: '1a',
            question: '',
            options: ['', '', '', ''],
            answer: '',
            explanation: '',
            year: new Date().getFullYear().toString(),
            session: 'Rain',
            marks: 2,
            difficulty: 'medium',
            isPremium: false
          }
        ])
        fetchQuestions()
      }
    } catch (err) {
      alert('Error adding question: ' + err.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleUploadCBT = async (e) => {
    e.preventDefault()
    if (!cbtCourse || !cbtJson) {
      alert('Please select a course and paste bulk CBT question JSON data')
      return
    }

    try {
      setIsSubmitting(true)
      let payload = JSON.parse(cbtJson)
      if (payload.questions && Array.isArray(payload.questions)) {
        payload = payload.questions
      }

      if (!Array.isArray(payload)) {
        throw new Error('CBT data must be a JSON array of question objects')
      }

      const res = await apiPost('/api/questions/bulk', {
        course: cbtCourse,
        questions: payload
      })

      if (res.success) {
        alert(`Uploaded ${res.count || res.questions.length} CBT questions successfully!`)
        setCbtJson('')
        setCbtCourse('')
        fetchQuestions()
      }
    } catch (err) {
      alert('Error uploading CBT set: ' + err.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleOptionChange = (idx, value) => {
    const newOptions = [...questionData.options]
    newOptions[idx] = value
    setQuestionData({ ...questionData, options: newOptions })
  }

  const handleSubOptionChange = (questionIndex, optionIndex, value) => {
    const newSubQuestions = [...subQuestions]
    newSubQuestions[questionIndex].options[optionIndex] = value
    setSubQuestions(newSubQuestions)
  }

  const handleSubQuestionChange = (questionIndex, field, value) => {
    const newSubQuestions = [...subQuestions]
    newSubQuestions[questionIndex] = { ...newSubQuestions[questionIndex], [field]: value }
    setSubQuestions(newSubQuestions)
  }

  const addSubQuestion = () => {
    setSubQuestions((prev) => [
      ...prev,
      {
        label: `1${String.fromCharCode(97 + prev.length)}`,
        question: '',
        options: ['', '', '', ''],
        answer: '',
        explanation: '',
        year: new Date().getFullYear().toString(),
        session: 'Rain',
        marks: 2,
        difficulty: 'medium',
        isPremium: false
      }
    ])
  }

  const removeSubQuestion = (index) => {
    setSubQuestions((prev) => prev.filter((_, idx) => idx !== index))
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 text-lg mb-4">Loading admin panel...</p>
          <p className="text-sm text-gray-500">If this takes too long, try refreshing the page.</p>
        </div>
      </div>
    )
  }

  if (!user || user.role?.toLowerCase() !== 'admin') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center px-6">
        <div className="max-w-lg bg-white rounded-lg shadow-lg p-10 text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-3">❌ Access Denied</h1>
          <p className="text-gray-700 mb-4">Your account is not an admin.</p>
          <p className="text-sm text-gray-500 mb-6">If you believe this is an error, contact your administrator or try logging out and back in.</p>
          <p className="text-xs text-gray-400">User role: {user?.role || 'unknown'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="bg-gradient-to-r from-red-600 to-orange-600 text-white px-6 py-8">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-4xl font-bold mb-2">🛡️ Admin Panel</h1>
          <p className="text-red-100">Manage courses, CBT sets, materials, and past questions</p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex gap-2 mb-6 flex-wrap">
          {['addCourse', 'uploadMaterial', 'addQuestion', 'uploadCBT', 'viewCourses', 'viewMaterials', 'viewQuestions'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-3 font-semibold rounded-lg transition ${
                activeTab === tab
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              {tab === 'addCourse' && '📘 Add Course'}
              {tab === 'uploadMaterial' && '📁 Upload Material'}
              {tab === 'addQuestion' && '❓ Add Question'}
              {tab === 'uploadCBT' && '🧠 Upload CBT Set'}
              {tab === 'viewCourses' && '📚 View Courses'}
              {tab === 'viewMaterials' && '📋 View Materials'}
              {tab === 'viewQuestions' && '📝 View Questions'}
            </button>
          ))}
        </div>

        {activeTab === 'addCourse' && (
          <div className="bg-white rounded-lg shadow-lg p-8">
            <h2 className="text-2xl font-bold mb-6">Add New Course</h2>
            <form onSubmit={handleCreateCourse} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Course Title *</label>
                  <input
                    type="text"
                    value={courseTitle}
                    onChange={(e) => setCourseTitle(e.target.value)}
                    placeholder="e.g., Calculus I"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Course Code *</label>
                  <input
                    type="text"
                    value={courseCode}
                    onChange={(e) => setCourseCode(e.target.value)}
                    placeholder="e.g., MTH101"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Department *</label>
                  <select
                    value={courseDepartment}
                    onChange={(e) => setCourseDepartment(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    required
                  >
                    <option value="">-- Select department --</option>
                    {departments.map((dept) => (
                      <option key={dept._id} value={dept._id}>{dept.name} ({dept.code})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Level</label>
                  <select
                    value={courseLevel}
                    onChange={(e) => setCourseLevel(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="ND1">ND1</option>
                    <option value="ND2">ND2</option>
                    <option value="HND1">HND1</option>
                    <option value="HND2">HND2</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Semester</label>
                  <select
                    value={courseSemester}
                    onChange={(e) => setCourseSemester(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="First">First</option>
                    <option value="Second">Second</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Credit Units</label>
                  <input
                    type="number"
                    value={courseCreditUnits}
                    onChange={(e) => setCourseCreditUnits(Number(e.target.value))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex items-center mt-6">
                  <input
                    type="checkbox"
                    checked={courseIsPremium}
                    onChange={(e) => setCourseIsPremium(e.target.checked)}
                    className="w-4 h-4 mr-3"
                  />
                  <label className="text-sm font-semibold text-gray-700">Mark course as Premium</label>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Course Description</label>
                <textarea
                  value={courseDescription}
                  onChange={(e) => setCourseDescription(e.target.value)}
                  rows="3"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="Describe subject, prerequisites, or exam focus"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white font-bold py-3 rounded-lg transition"
              >
                {isSubmitting ? 'Saving...' : '➕ Create Course'}
              </button>
            </form>
          </div>
        )}

        {activeTab === 'uploadCBT' && (
          <div className="bg-white rounded-lg shadow-lg p-8">
            <h2 className="text-2xl font-bold mb-6">Upload CBT Question Set</h2>
            <form onSubmit={handleUploadCBT} className="space-y-6">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Select Course *</label>
                <select
                  value={cbtCourse}
                  onChange={(e) => setCbtCourse(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  required
                >
                  <option value="">-- Select a course --</option>
                  {courses.map(c => (
                    <option key={c._id} value={c._id}>{c.title} ({c.code})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Bulk CBT Questions JSON *</label>
                <textarea
                  value={cbtJson}
                  onChange={(e) => setCbtJson(e.target.value)}
                  rows="12"
                  placeholder='[ { "topic": "Loops", "question": "What is a loop?", "options": ["A", "B"], "answer": "A" }, ... ]'
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">Paste an array of question objects or an object with a questions array.</p>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-amber-600 hover:bg-amber-700 disabled:bg-gray-400 text-white font-bold py-3 rounded-lg transition"
              >
                {isSubmitting ? 'Importing...' : '📥 Upload CBT Set'}
              </button>
            </form>
          </div>
        )}

        {activeTab === 'viewCourses' && (
          <div className="bg-white rounded-lg shadow-lg p-8">
            <h2 className="text-2xl font-bold mb-6">Courses</h2>
            {courses.length === 0 ? (
              <p className="text-gray-600">No courses available yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-4 py-2 text-left">Title</th>
                      <th className="px-4 py-2 text-left">Code</th>
                      <th className="px-4 py-2 text-left">Department</th>
                      <th className="px-4 py-2 text-left">Level</th>
                      <th className="px-4 py-2 text-left">Premium</th>
                    </tr>
                  </thead>
                  <tbody>
                    {courses.map(course => (
                      <tr key={course._id} className="border-b hover:bg-gray-50">
                        <td className="px-4 py-2">{course.title}</td>
                        <td className="px-4 py-2">{course.code}</td>
                        <td className="px-4 py-2">{course.department?.name || 'N/A'}</td>
                        <td className="px-4 py-2">{course.level}</td>
                        <td className="px-4 py-2">{course.isPremium ? '⭐ Yes' : '✓ Free'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'uploadMaterial' && (
          <div className="bg-white rounded-lg shadow-lg p-8">
            <h2 className="text-2xl font-bold mb-6">Upload Course Material</h2>
            <form onSubmit={handleUploadMaterial} className="space-y-6">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Select Course *</label>
                <select
                  value={selectedCourse}
                  onChange={(e) => setSelectedCourse(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  required
                >
                  <option value="">-- Select a course --</option>
                  {courses.map(c => (
                    <option key={c._id} value={c._id}>{c.title} ({c.code})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Material Title *</label>
                <input
                  type="text"
                  value={materialTitle}
                  onChange={(e) => setMaterialTitle(e.target.value)}
                  placeholder="e.g., Lecture Slides Week 1"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Upload File *</label>
                <input
                  type="file"
                  onChange={(e) => setMaterialFile(e.target.files?.[0] || null)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">Supported: PDF, DOC, DOCX, PPT, PPTX, XLS, XLSX (max 50MB)</p>
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={materialIsPremium}
                  onChange={(e) => setMaterialIsPremium(e.target.checked)}
                  className="w-4 h-4 mr-3"
                />
                <label className="text-sm font-semibold text-gray-700">Mark as Premium (only premium users can access)</label>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-bold py-3 rounded-lg transition"
              >
                {isSubmitting ? 'Uploading...' : '📤 Upload Material'}
              </button>
            </form>
          </div>
        )}

        {activeTab === 'addQuestion' && (
          <div className="bg-white rounded-lg shadow-lg p-8">
            <h2 className="text-2xl font-bold mb-6">Add Past Question</h2>
            <form onSubmit={handleAddQuestion} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Select Course *</label>
                  <select
                    value={questionCourse}
                    onChange={(e) => setQuestionCourse(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    required
                  >
                    <option value="">-- Select a course --</option>
                    {courses.map(c => (
                      <option key={c._id} value={c._id}>{c.title} ({c.code})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Topic *</label>
                  <input
                    type="text"
                    value={questionData.topic}
                    onChange={(e) => setQuestionData({ ...questionData, topic: e.target.value })}
                    placeholder="e.g., Advanced Thermodynamics"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Question Text *</label>
                <textarea
                  value={questionData.question}
                  onChange={(e) => setQuestionData({ ...questionData, question: e.target.value })}
                  placeholder="Enter the question"
                  rows="3"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={hasSubQuestions}
                  onChange={(e) => setHasSubQuestions(e.target.checked)}
                  className="w-4 h-4"
                />
                <label className="text-sm font-semibold text-gray-700">This question has sub-questions</label>
              </div>

              {hasSubQuestions ? (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">Sub-questions</h3>
                    <button
                      type="button"
                      onClick={addSubQuestion}
                      className="text-sm text-blue-600 hover:text-blue-800"
                    >
                      + Add sub-question
                    </button>
                  </div>

                  {subQuestions.map((sub, idx) => (
                    <div key={idx} className="p-4 border border-gray-200 rounded-lg bg-gray-50">
                      <div className="flex items-start justify-between gap-4 mb-4">
                        <div>
                          <p className="font-semibold text-gray-800">Sub-question {sub.label}</p>
                        </div>
                        {subQuestions.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeSubQuestion(idx)}
                            className="text-sm text-red-600 hover:text-red-800"
                          >
                            Remove
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-2">Label</label>
                          <input
                            type="text"
                            value={sub.label}
                            onChange={(e) => handleSubQuestionChange(idx, 'label', e.target.value)}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-2">Marks</label>
                          <input
                            type="number"
                            value={sub.marks}
                            onChange={(e) => handleSubQuestionChange(idx, 'marks', parseInt(e.target.value) || 0)}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Sub-question Text *</label>
                        <textarea
                          value={sub.question}
                          onChange={(e) => handleSubQuestionChange(idx, 'question', e.target.value)}
                          rows="3"
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Options *</label>
                        <div className="space-y-2">
                          {sub.options.map((opt, optIdx) => (
                            <input
                              key={optIdx}
                              type="text"
                              value={opt}
                              onChange={(e) => handleSubOptionChange(idx, optIdx, e.target.value)}
                              placeholder={`Option ${String.fromCharCode(65 + optIdx)}`}
                              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                              required
                            />
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Correct Answer *</label>
                        <input
                          type="text"
                          value={sub.answer}
                          onChange={(e) => handleSubQuestionChange(idx, 'answer', e.target.value)}
                          placeholder="e.g., Option A"
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                          required
                        />
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-2">Session</label>
                          <select
                            value={sub.session}
                            onChange={(e) => handleSubQuestionChange(idx, 'session', e.target.value)}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="Rain">Rain</option>
                            <option value="Harmattan">Harmattan</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-2">Difficulty</label>
                          <select
                            value={sub.difficulty}
                            onChange={(e) => handleSubQuestionChange(idx, 'difficulty', e.target.value)}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="easy">Easy</option>
                            <option value="medium">Medium</option>
                            <option value="hard">Hard</option>
                          </select>
                        </div>

                        <div className="flex items-center mt-6">
                          <input
                            type="checkbox"
                            checked={sub.isPremium}
                            onChange={(e) => handleSubQuestionChange(idx, 'isPremium', e.target.checked)}
                            className="w-4 h-4 mr-3"
                          />
                          <label className="text-sm font-semibold text-gray-700">Premium</label>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Options *</label>
                    <div className="space-y-2">
                      {questionData.options.map((opt, idx) => (
                        <input
                          key={idx}
                          type="text"
                          value={opt}
                          onChange={(e) => handleOptionChange(idx, e.target.value)}
                          placeholder={`Option ${String.fromCharCode(65 + idx)}`}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                          required
                        />
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Correct Answer *</label>
                    <input
                      type="text"
                      value={questionData.answer}
                      onChange={(e) => setQuestionData({ ...questionData, answer: e.target.value })}
                      placeholder="e.g., Option A"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>
                </>
              )}

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Explanation</label>
                <textarea
                  value={questionData.explanation}
                  onChange={(e) => setQuestionData({ ...questionData, explanation: e.target.value })}
                  placeholder="Provide explanation for the answer"
                  rows="2"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Year *</label>
                  <input
                    type="text"
                    value={questionData.year}
                    onChange={(e) => setQuestionData({ ...questionData, year: e.target.value })}
                    placeholder="2024"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Session</label>
                  <select
                    value={questionData.session}
                    onChange={(e) => setQuestionData({ ...questionData, session: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="Rain">Rain</option>
                    <option value="Harmattan">Harmattan</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Marks</label>
                  <input
                    type="number"
                    value={questionData.marks}
                    onChange={(e) => setQuestionData({ ...questionData, marks: parseInt(e.target.value) })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Difficulty</label>
                  <select
                    value={questionData.difficulty}
                    onChange={(e) => setQuestionData({ ...questionData, difficulty: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={questionData.isPremium}
                  onChange={(e) => setQuestionData({ ...questionData, isPremium: e.target.checked })}
                  className="w-4 h-4 mr-3"
                />
                <label className="text-sm font-semibold text-gray-700">Mark as Premium</label>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-bold py-3 rounded-lg transition"
              >
                {isSubmitting ? 'Adding...' : '➕ Add Question'}
              </button>
            </form>
          </div>
        )}

        {activeTab === 'viewMaterials' && (
          <div className="bg-white rounded-lg shadow-lg p-8">
            <h2 className="text-2xl font-bold mb-6">Uploaded Materials</h2>
            {materials.length === 0 ? (
              <p className="text-gray-600">No materials uploaded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-4 py-2 text-left">Title</th>
                      <th className="px-4 py-2 text-left">Course</th>
                      <th className="px-4 py-2 text-left">Premium</th>
                      <th className="px-4 py-2 text-left">Uploaded</th>
                    </tr>
                  </thead>
                  <tbody>
                    {materials.map(m => (
                      <tr key={m._id} className="border-b hover:bg-gray-50">
                        <td className="px-4 py-2">{m.title}</td>
                        <td className="px-4 py-2">{m.course?.title || 'N/A'}</td>
                        <td className="px-4 py-2">{m.isPremium ? '⭐ Yes' : '✓ Free'}</td>
                        <td className="px-4 py-2">{new Date(m.uploadedAt || m.createdAt).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'viewQuestions' && (
          <div className="bg-white rounded-lg shadow-lg p-8">
            <h2 className="text-2xl font-bold mb-6">Uploaded Questions</h2>
            {questions.length === 0 ? (
              <p className="text-gray-600">No questions uploaded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-4 py-2 text-left">Topic</th>
                      <th className="px-4 py-2 text-left">Course</th>
                      <th className="px-4 py-2 text-left">Year</th>
                      <th className="px-4 py-2 text-left">Session</th>
                      <th className="px-4 py-2 text-left">Difficulty</th>
                      <th className="px-4 py-2 text-left">Premium</th>
                    </tr>
                  </thead>
                  <tbody>
                    {questions.map(q => (
                      <tr key={q._id} className="border-b hover:bg-gray-50">
                        <td className="px-4 py-2">{q.topic}</td>
                        <td className="px-4 py-2">{q.course?.title || 'N/A'}</td>
                        <td className="px-4 py-2">{q.year}</td>
                        <td className="px-4 py-2">{q.session}</td>
                        <td className="px-4 py-2">
                          <span className={`px-2 py-1 rounded text-xs font-bold ${
                            q.difficulty === 'easy' ? 'bg-green-100 text-green-700' :
                            q.difficulty === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                            'bg-red-100 text-red-700'
                          }`}>
                            {q.difficulty}
                          </span>
                        </td>
                        <td className="px-4 py-2">{q.isPremium ? '⭐' : '✓'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
