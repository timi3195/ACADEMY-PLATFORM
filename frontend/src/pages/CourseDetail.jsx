import React, { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiGet } from '../utils/api'
import { useAuth } from '../utils/auth'
import PDFViewer from '../components/PDFViewer'
import CBTPracticeLink from '../components/CBTPracticeLink'
import { canAccessCbtPractice } from '../utils/cbt'
import { isCourseAccessibleToUser } from '../utils/courseAccess'
import CourseProgressPanel from '../components/CourseProgressPanel'
import CourseMaterialCompletion from '../components/CourseMaterialCompletion'
import useCourseMaterialProgress from '../hooks/useCourseMaterialProgress'

export default function CourseDetail() {
  const { courseId } = useParams()
  const { user } = useAuth()
  const {
    progress,
    loading: progressLoading,
    savingMaterialId,
    error: progressError,
    updateCompletion,
    retry: retryProgress
  } = useCourseMaterialProgress(user?.role === 'student' ? courseId : null)
  const [course, setCourse] = useState(null)
  const [materials, setMaterials] = useState([])
  const [pastQuestionPapers, setPastQuestionPapers] = useState([])
  const [pastQuestionPapersLoading, setPastQuestionPapersLoading] = useState(false)
  const [pastQuestionPapersError, setPastQuestionPapersError] = useState('')
  const [activeTab, setActiveTab] = useState('overview')
  const [loading, setLoading] = useState(true)
  const [selectedYear, setSelectedYear] = useState('')
  const [openPastQuestionPaperId, setOpenPastQuestionPaperId] = useState('')

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
    if (!courseId || !selectedYear) {
      setPastQuestionPapers([])
      setPastQuestionPapersError('')
      setPastQuestionPapersLoading(false)
      return
    }

    let active = true
    const fetchPastQuestionPapers = async () => {
      setPastQuestionPapersLoading(true)
      setPastQuestionPapersError('')
      try {
        const query = new URLSearchParams({
          course: courseId,
          examinationYear: selectedYear
        })
        const res = await apiGet(`/api/files/past-questions?${query.toString()}`)
        if (active) setPastQuestionPapers(res.papers || [])
      } catch (err) {
        console.error(err)
        if (active) {
          setPastQuestionPapers([])
          setPastQuestionPapersError(err.message || 'Unable to load past-question papers.')
        }
      } finally {
        if (active) setPastQuestionPapersLoading(false)
      }
    }

    fetchPastQuestionPapers()
    return () => {
      active = false
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

  const canAccessMaterial = (file) => {
    return file.accessible === true
  }

  const hasCourseAccess = () => {
    return isCourseAccessibleToUser(user, course)
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
          <p className="text-gray-600 mb-6">This course is available to students in its assigned department.</p>
          <p className="text-sm text-gray-500 mb-6">If you believe this is a mistake, contact an administrator for access.</p>
          <Link to="/courses" className="inline-flex items-center justify-center px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
            Back to Courses
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="course-detail-page min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <header className="course-detail-header bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-8">
        <div className="course-detail-header-content max-w-6xl mx-auto">
          <Link to="/" className="text-blue-100 hover:text-white mb-4 inline-block">← Back to Dashboard</Link>
          <h1 className="text-4xl font-bold mb-2">{course.title}</h1>
          <div className="flex flex-wrap items-center gap-4 text-blue-100">
            <span>📌 {course.code}</span>
            <span>🏢 {course.department?.name || 'Department'}</span>
            <span>📚 {course.level}</span>
            {canAccessCbtPractice(user) && (
              <CBTPracticeLink courseId={course._id} />
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="course-detail-content max-w-6xl mx-auto px-6 py-8">
        {/* Tabs */}
        <div className="course-detail-tabs flex gap-4 border-b border-gray-200 mb-6">
          {['overview', 'materials', 'questions'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`course-detail-tab px-4 py-3 font-semibold capitalize transition ${
                activeTab === tab
                  ? 'active text-blue-600 border-b-2 border-blue-600'
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
        <div className="course-detail-panel bg-white rounded-lg shadow-lg p-8">
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-xl font-bold mb-3">Description</h3>
                <p className="text-gray-700">{course.description || 'No description available.'}</p>
              </div>

              <div className="course-detail-stat-grid grid grid-cols-2 md:grid-cols-4 gap-4">
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
                  <p className="text-sm text-gray-600">Materials</p>
                  <p className="text-2xl font-bold text-orange-600">Free to access</p>
                </div>
              </div>
            </div>
          )}

          {/* Materials Tab */}
          {activeTab === 'materials' && (
            <div className="space-y-4">
              {user?.role === 'student' && (
                <CourseProgressPanel
                  progress={progress}
                  loading={progressLoading}
                  error={progressError}
                  onRetry={retryProgress}
                />
              )}
              {materials.length === 0 ? (
                <p className="text-gray-600 text-center py-8">No materials available for this course yet.</p>
              ) : (
                materials.map(file => {
                  const canAccess = canAccessMaterial(file)
                  const isAvailable = file.available !== false
                  const materialProgress = progress?.materials?.find((item) => item.materialId === String(file._id))
                  const canDownload = Boolean(user && isAvailable && (user.role === 'admin' || canAccess))

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
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          {canAccess && isAvailable ? (
                            (canDownload ? (
                              <a
                                onClick={async (event) => {
                                  event.preventDefault();
                                  try {
                                    const response = await (await import('../services/fileService')).default.downloadFile(file._id);
                                    const blob = new Blob([response.data], { type: response.headers?.['content-type'] || 'application/octet-stream' });
                                    const objectUrl = URL.createObjectURL(blob);
                                    const anchor = document.createElement('a');
                                    anchor.href = objectUrl;
                                    anchor.download = file.title || 'material';
                                    document.body.appendChild(anchor);
                                    anchor.click();
                                    anchor.remove();
                                    URL.revokeObjectURL(objectUrl);
                                  } catch (downloadError) {
                                    const message = downloadError?.response?.data?.message || downloadError?.message || 'Unable to download this file.';
                                    window.alert(message);
                                  }
                                }}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition"
                              >
                                📥 Download
                              </a>
                            ) : (
                              <span className="text-sm text-red-700 font-bold">Not available to this account</span>
                            ))
                          ) : canAccess ? (
                            <span className="text-sm text-amber-700 font-medium">Material unavailable</span>
                          ) : (
                            <>
                              <span className="text-sm text-red-700 font-bold">Not available to this account</span>
                            </>
                          )}
                        </div>
                      </div>

                      {user?.role === 'student' && canAccess && isAvailable && (
                        <CourseMaterialCompletion
                          completed={Boolean(materialProgress?.completed)}
                          saving={savingMaterialId === String(file._id)}
                          disabled={progressLoading || Boolean(progressError) || !materialProgress}
                          onChange={(completed) => updateCompletion(String(file._id), completed)}
                        />
                      )}

                      {/* Inline file preview - the reader handles PDF and DOCX automatically */}
                      {canAccess && isAvailable && (
                        <div className="mt-4">
                          <PDFViewer fileUrl={file.fileUrl} fileName={file.title} downloadUrl={`/api/files/download/${file._id}`} canDownload={canDownload} materialId={file._id} />
                        </div>
                      )}
                      {canAccess && !isAvailable && (
                        <p className="mt-3 text-sm text-amber-700">
                          This file is unavailable and is excluded from course progress.
                        </p>
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
              ) : pastQuestionPapersLoading ? (
                <p className="text-gray-600 text-center py-8">Loading past-question papers...</p>
              ) : pastQuestionPapersError ? (
                <p className="text-red-600 text-center py-8" role="alert">{pastQuestionPapersError}</p>
              ) : pastQuestionPapers.filter((paper) => String(paper.examinationYear) === selectedYear).length === 0 ? (
                <p className="text-gray-600 text-center py-8">No past questions found for {selectedYear}.</p>
              ) : (
                <div className="space-y-4">
                  {pastQuestionPapers
                    .filter((paper) => String(paper.examinationYear) === selectedYear)
                    .map((paper) => (
                      <article key={paper._id} className="p-4 border border-gray-200 rounded-lg bg-white">
                        <div className="flex flex-wrap items-center justify-between gap-4">
                          <div>
                            <h3 className="text-lg font-bold text-gray-900">{paper.title}</h3>
                            <p className="text-sm text-gray-600">
                              {paper.originalName || paper.title} • {paper.level} • {paper.semester} • {paper.examinationYear}
                            </p>
                          </div>
                          <button
                            type="button"
                            className="bg-blue-600 text-white px-4 py-2 rounded-lg"
                            aria-expanded={openPastQuestionPaperId === paper._id}
                            onClick={() => setOpenPastQuestionPaperId((currentId) => currentId === paper._id ? '' : paper._id)}
                          >
                            {openPastQuestionPaperId === paper._id ? 'Close Past Question' : 'Open Past Question'}
                          </button>
                        </div>
                        {openPastQuestionPaperId === paper._id && (
                          <div className="mt-4">
                            <PDFViewer
                              fileName={paper.originalName || paper.title}
                              pastQuestionPaperId={paper._id}
                              canDownload={false}
                            />
                          </div>
                        )}
                      </article>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
