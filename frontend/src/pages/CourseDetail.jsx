import React, { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiGet } from '../utils/api'
import { useAuth } from '../utils/auth'
import PDFViewer from '../components/PDFViewer'

export default function CourseDetail() {
  const { courseId } = useParams()
  const { user } = useAuth()
  const [course, setCourse] = useState(null)
  const [materials, setMaterials] = useState([])
  const [questions, setQuestions] = useState([])
  const [activeTab, setActiveTab] = useState('overview')
  const [loading, setLoading] = useState(true)
  const [selectedYear, setSelectedYear] = useState('')

  const currentYear = new Date().getFullYear()
  const years = Array.from({ length: 5 }, (_, i) => (currentYear - i).toString())

  useEffect(() => {
    if (courseId) {
      setLoading(true)
      Promise.all([fetchCourse(), fetchMaterials()]).finally(() => {
        setLoading(false)
      })
    }
  }, [courseId])

  useEffect(() => {
    if (courseId && selectedYear) {
      setLoading(true)
      fetchQuestions(selectedYear)
    }
  }, [courseId, selectedYear])

  const fetchCourse = async () => {
    try {
      const res = await apiGet(`/api/courses/${courseId}`)
      setCourse(res.course)
    } catch (err) {
      console.error(err)
    }
  }

  const fetchMaterials = async () => {
    try {
      const res = await apiGet(`/api/files/course/${courseId}`)
      setMaterials(res.files || [])
    } catch (err) {
      console.error(err)
    }
  }

  const fetchQuestions = async (year) => {
    if (!year) {
      setQuestions([])
      return
    }

    try {
      const res = await apiGet(`/api/questions/course/${courseId}?year=${year}`)
      setQuestions(res.questions || [])
      setLoading(false)
    } catch (err) {
      console.error(err)
      setLoading(false)
    }
  }

  const canAccessMaterial = (file) => {
    if (!file.isPremium) return true
    if (!user) return false
    if (user.role === 'admin') return true
    const isPremium = user.plan === 'premium' || user.subscriptionType === 'premium'
    const notExpired = !user.subscriptionExpiresAt || new Date(user.subscriptionExpiresAt) > new Date()
    return isPremium && notExpired
  }

  const isObjectiveQuestion = (q) => {
    if (q.options && q.options.length > 0) return true
    if (Array.isArray(q.subQuestions) && q.subQuestions.some(sub => Array.isArray(sub.options) && sub.options.length > 0)) return true
    return false
  }

  const objectiveQuestions = questions.filter(isObjectiveQuestion)
  const theoryQuestions = questions.filter((q) => !isObjectiveQuestion(q))

  const hasCourseAccess = () => {
    if (!course) return false
    if (user?.role === 'admin') return true
    if (!user?.department || !user?.yearOfStudy) return false
    const courseDeptId = course.department?._id?.toString?.() || course.department?._id
    const userDeptId = (user.department._id || user.department)?.toString?.() || (user.department._id || user.department)
    return courseDeptId === userDeptId && course.level === user.yearOfStudy
  }

  if (!course || loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <p className="text-gray-600 text-lg">Loading...</p>
      </div>
    )
  }

  if (!hasCourseAccess()) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center px-6 py-12">
        <div className="max-w-xl w-full bg-white rounded-3xl shadow-xl border border-gray-200 p-10 text-center">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">Course Access Restricted</h1>
          <p className="text-gray-600 mb-6">This course is only available to students in the assigned department and year of study.</p>
          <p className="text-sm text-gray-500 mb-6">If you believe this is a mistake, contact an administrator for access.</p>
          <Link to="/courses" className="inline-flex items-center justify-center px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
            Back to Courses
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-8">
        <div className="max-w-6xl mx-auto">
          <Link to="/" className="text-blue-100 hover:text-white mb-4 inline-block">← Back to Dashboard</Link>
          <h1 className="text-4xl font-bold mb-2">{course.title}</h1>
          <div className="flex items-center gap-4 text-blue-100">
            <span>📌 {course.code}</span>
            <span>🏢 {course.department?.name || 'Department'}</span>
            <span>📚 {course.level}</span>
            {course.isPremium && <span className="bg-yellow-400 text-yellow-900 px-2 py-1 rounded text-sm font-bold">⭐ Premium</span>}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Tabs */}
        <div className="flex gap-4 border-b border-gray-200 mb-6">
          {['overview', 'materials', 'questions'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-3 font-semibold capitalize transition ${
                activeTab === tab
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              {tab === 'overview' && '📖 Overview'}
              {tab === 'materials' && '📁 Materials'}
              {tab === 'questions' && '❓ Past Questions'}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="bg-white rounded-lg shadow-lg p-8">
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-xl font-bold mb-3">Description</h3>
                <p className="text-gray-700">{course.description || 'No description available.'}</p>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-blue-50 p-4 rounded-lg">
                  <p className="text-sm text-gray-600">Credit Units</p>
                  <p className="text-2xl font-bold text-blue-600">{course.creditUnits}</p>
                </div>
                <div className="bg-purple-50 p-4 rounded-lg">
                  <p className="text-sm text-gray-600">Semester</p>
                  <p className="text-2xl font-bold text-purple-600">{course.semester}</p>
                </div>
                <div className="bg-green-50 p-4 rounded-lg">
                  <p className="text-sm text-gray-600">Level</p>
                  <p className="text-2xl font-bold text-green-600">{course.level}</p>
                </div>
                <div className="bg-orange-50 p-4 rounded-lg">
                  <p className="text-sm text-gray-600">Status</p>
                  <p className="text-2xl font-bold text-orange-600">{course.isPremium ? 'Premium' : 'Free'}</p>
                </div>
              </div>
            </div>
          )}

          {/* Materials Tab */}
          {activeTab === 'materials' && (
            <div className="space-y-4">
              {materials.length === 0 ? (
                <p className="text-gray-600 text-center py-8">No materials available for this course yet.</p>
              ) : (
                materials.map(file => {
                  const canAccess = canAccessMaterial(file)
                  const isPDF = file.fileUrl?.toLowerCase().endsWith('.pdf') || file.fileUrl?.includes('.pdf')
                  
                  return (
                    <div
                      key={file._id}
                      className={`p-4 rounded-lg border-2 transition ${
                        canAccess
                          ? 'border-green-200 bg-green-50 hover:bg-green-100'
                          : 'border-red-200 bg-red-50'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex-1">
                          <h4 className="font-bold text-gray-800">{file.title}</h4>
                          <p className="text-sm text-gray-600">
                            {new Date(file.createdAt).toLocaleDateString()}
                            {file.isPremium && ' • 🔒 Premium'}
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          {canAccess ? (
                            !isPDF && (
                              <a
                                href={file.fileUrl}
                                download
                                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition"
                                target="_blank"
                                rel="noreferrer"
                              >
                                📥 Download
                              </a>
                            )
                          ) : (
                            <>
                              <span className="text-sm text-red-700 font-bold">Locked</span>
                              <Link to="/upgrade" className="bg-yellow-400 hover:bg-yellow-500 text-yellow-900 px-4 py-2 rounded-lg transition font-bold">
                                ⭐ Unlock
                              </Link>
                            </>
                          )}
                        </div>
                      </div>

                      {/* PDF Viewer - embedded for inline viewing */}
                      {canAccess && isPDF && (
                        <div className="mt-4">
                          <PDFViewer fileUrl={file.fileUrl} fileName={file.title} />
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          )}


          {/* Past Questions Tab */}
          {activeTab === 'questions' && (
            <div className="space-y-8">
              <div className="mb-6 max-w-sm">
                <label className="block text-sm font-semibold text-gray-700 mb-2">Select year</label>
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(e.target.value)}
                  className="w-full p-3 border border-gray-300 rounded-lg"
                >
                  <option value="">Choose a year</option>
                  {years.map((year) => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
              </div>

              {!selectedYear ? (
                <div className="p-6 border border-dashed border-gray-300 rounded-lg bg-gray-50">
                  <p className="text-gray-700">Please select a year to view this course's past questions. Past questions are available for the last 5 years.</p>
                </div>
              ) : questions.length === 0 ? (
                <p className="text-gray-600 text-center py-8">No past questions found for {selectedYear}.</p>
              ) : (
                <>
                  <section className="space-y-4">
                    <h3 className="text-xl font-bold text-blue-700">Objective Questions</h3>
                    {objectiveQuestions.length === 0 ? (
                      <p className="text-gray-600">No objective questions are available for this course yet.</p>
                    ) : (
                      objectiveQuestions.map(q => (
                        <div key={q._id} className="p-4 border border-gray-200 rounded-lg hover:shadow-md transition">
                          <div className="mb-3">
                            <p className="font-semibold text-gray-800">{q.question}</p>
                            <p className="text-xs text-gray-500 mt-1">
                              Year: {q.year || 'N/A'} • Session: {q.session || 'N/A'}
                            </p>
                          </div>

                          {q.subQuestions && q.subQuestions.length > 0 ? (
                            <div className="space-y-4">
                              {q.subQuestions.map((sub, subIdx) => (
                                <div key={subIdx} className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                                  <div className="mb-2">
                                    <p className="font-semibold text-gray-800">{sub.label || `Part ${subIdx + 1}`}</p>
                                    <p className="text-sm text-gray-600 mt-1">{sub.question}</p>
                                  </div>
                                  {sub.options && sub.options.length > 0 ? (
                                    <div className="space-y-2">
                                      {sub.options.map((opt, optIdx) => (
                                        <label key={optIdx} className="flex items-center gap-3 cursor-pointer">
                                          <input type="radio" name={`q-${q._id}-sub-${subIdx}`} className="w-4 h-4" />
                                          <span className="text-gray-700">{opt}</span>
                                        </label>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="text-gray-500">No options available for this sub-question.</p>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {q.options && q.options.length > 0 ? (
                                q.options.map((opt, idx) => (
                                  <label key={idx} className="flex items-center gap-3 cursor-pointer">
                                    <input type="radio" name={`q-${q._id}`} className="w-4 h-4" />
                                    <span className="text-gray-700">{opt}</span>
                                  </label>
                                ))
                              ) : (
                                <p className="text-gray-500">No options available</p>
                              )}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </section>

                  <section className="space-y-4">
                    <h3 className="text-xl font-bold text-amber-700">Theory Questions</h3>
                    {theoryQuestions.length === 0 ? (
                      <p className="text-gray-600">No theory questions are available for this course yet.</p>
                    ) : (
                      theoryQuestions.map(q => (
                        <div key={q._id} className="p-4 border border-gray-200 rounded-lg bg-slate-50">
                          <div className="mb-3">
                            <p className="font-semibold text-gray-800">{q.question}</p>
                            <p className="text-xs text-gray-500 mt-1">
                              Year: {q.year || 'N/A'} • Session: {q.session || 'N/A'}
                            </p>
                          </div>
                          <p className="text-gray-700">{q.explanation || 'This is a theory question and may require an essay-style response.'}</p>
                        </div>
                      ))
                    )}
                  </section>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
