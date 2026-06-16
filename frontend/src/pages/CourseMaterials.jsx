import React, { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { apiGet } from '../utils/api'
import { useAuth } from '../utils/auth'
import PDFViewer from '../components/PDFViewer'

export default function CourseMaterials() {
  const { courseId } = useParams()
  const { user } = useAuth()
  const [course, setCourse] = useState(null)
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!courseId) return
    fetchCourse()
    fetchFiles()
  }, [courseId])

  const fetchCourse = async () => {
    try {
      const res = await apiGet(`/api/courses/${courseId}`)
      setCourse(res.course)
    } catch (err) {
      console.error(err)
      setError('Failed to load course information')
    }
  }

  const fetchFiles = async () => {
    try {
      setLoading(true)
      const res = await apiGet(`/api/files/course/${courseId}`)
      if (res && res.files) setFiles(res.files)
    } catch (err) {
      console.error(err)
      setError(err.message || 'Failed to load files')
    } finally {
      setLoading(false)
    }
  }

  const hasCourseAccess = () => {
    if (!course) return false
    if (user?.role === 'admin') return true
    if (!user?.department || !user?.yearOfStudy) return false
    const courseDeptId = course.department?._id?.toString?.() || course.department?._id
    const userDeptId = (user.department._id || user.department)?.toString?.() || (user.department._id || user.department)
    return courseDeptId === userDeptId && course.level === user.yearOfStudy
  }

  if (loading && !course) {
    return (
      <div className="max-w-4xl mx-auto py-8">
        <p className="text-gray-600">Loading course materials...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto py-8">
        <p className="text-red-600">{error}</p>
      </div>
    )
  }

  if (!hasCourseAccess()) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center px-6 py-12">
        <div className="max-w-xl w-full bg-white rounded-3xl shadow-xl border border-gray-200 p-10 text-center">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">Materials Access Restricted</h1>
          <p className="text-gray-600 mb-6">This course's materials are restricted to students in the assigned department and year.</p>
          <p className="text-sm text-gray-500 mb-6">Contact an administrator if you need access.</p>
          <Link to="/courses" className="inline-flex items-center justify-center px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
            Back to Courses
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto py-8 px-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">📚 Course Materials</h1>
        <Link to={`/courses/${courseId}`} className="text-blue-600 hover:text-blue-700 font-semibold">← Back to course</Link>
      </div>

      {files.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <p className="text-gray-600 text-lg">No materials uploaded for this course yet.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {files.map(f => {
            const isPDF = f.fileUrl?.toLowerCase().endsWith('.pdf') || f.fileUrl?.includes('.pdf')
            
            return (
              <div key={f._id} className={`rounded-lg border-2 overflow-hidden ${f.accessible ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
                {/* Material Header */}
                <div className="p-4 flex items-center justify-between">
                  <div className="flex-1">
                    <h3 className="font-bold text-lg text-gray-900">{f.title}</h3>
                    <p className="text-sm text-gray-600">Uploaded: {new Date(f.createdAt).toLocaleString()}</p>
                  </div>

                  {!f.accessible && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-red-700 font-bold">Premium Required</span>
                      <Link to="/upgrade" className="bg-yellow-400 hover:bg-yellow-500 text-yellow-900 px-4 py-2 rounded font-bold text-sm">
                        Upgrade
                      </Link>
                    </div>
                  )}
                </div>

                {/* Material Content */}
                {f.accessible && (
                  <div className="border-t border-green-200 p-4">
                    {isPDF ? (
                      <PDFViewer fileUrl={f.fileUrl} fileName={f.title} />
                    ) : (
                      <div className="flex flex-col items-center justify-center py-8 text-center">
                        <p className="text-gray-600 mb-4">📄 {f.title}</p>
                        <a
                          href={f.fileUrl}
                          download
                          className="inline-block px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-semibold"
                        >
                          📥 Download File
                        </a>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
