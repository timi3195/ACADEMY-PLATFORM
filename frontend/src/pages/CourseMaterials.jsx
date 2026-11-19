import React, { useEffect, useState } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { apiGet } from '../utils/api'
import { useAuth } from '../utils/auth'
import PDFViewer from '../components/PDFViewer'
import { isCourseAccessibleToUser } from '../utils/courseAccess'
import CourseProgressPanel from '../components/CourseProgressPanel'
import CourseMaterialCompletion from '../components/CourseMaterialCompletion'
import useCourseMaterialProgress from '../hooks/useCourseMaterialProgress'

export default function CourseMaterials() {
  const { courseId } = useParams()
  const [searchParams] = useSearchParams()
  const recommendedMaterialId = searchParams.get('materialId')
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
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!courseId) return
    fetchCourse()
    fetchFiles()
  }, [courseId])

  useEffect(() => {
    if (loading || !recommendedMaterialId) return
    const material = files.find((file) =>
      String(file._id) === recommendedMaterialId &&
      file.accessible !== false &&
      file.available !== false
    )
    if (!material) return
    document.getElementById(`course-material-${material._id}`)
      ?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  }, [files, loading, recommendedMaterialId])

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
    return isCourseAccessibleToUser(user, course)
  }
  const recommendedMaterialUnavailable = !loading &&
    recommendedMaterialId &&
    !files.some((file) =>
      String(file._id) === recommendedMaterialId &&
      file.accessible !== false &&
      file.available !== false
    )

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
          <p className="text-gray-600 mb-6">This course's materials are available to students in its assigned department.</p>
          <p className="text-sm text-gray-500 mb-6">Contact an administrator if you need access.</p>
          <Link to="/courses" className="inline-flex items-center justify-center px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
            Back to Courses
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Course Materials</h1>
        <Link to={`/courses/${courseId}`} className="text-sm text-blue-600">Back to course</Link>
      </div>

      {recommendedMaterialUnavailable && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" role="status">
          This recommended material is no longer available to your account. Other accessible materials are listed below.
        </p>
      )}

      {user?.role === 'student' && (
        <CourseProgressPanel
          progress={progress}
          loading={progressLoading}
          error={progressError}
          onRetry={retryProgress}
        />
      )}

      {files.length === 0 ? (
        <p className="text-gray-600">No materials uploaded for this course yet.</p>
      ) : (
        <div className="space-y-4">
          {files.map(f => {
            // Use backend 'accessible' field if available
            const isAccessible = 'accessible' in f ? f.accessible : true
            const isAvailable = f.available !== false
            const materialProgress = progress?.materials?.find((item) => item.materialId === String(f._id))
            const canDownload = Boolean(user && isAvailable)
            return (
              <div
                id={`course-material-${f._id}`}
                key={f._id}
                tabIndex={-1}
                className={`p-4 rounded-lg border ${isAccessible ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-semibold">{f.title}</h3>
                    <p className="text-xs text-gray-600">Uploaded: {new Date(f.createdAt).toLocaleString()}</p>
                  </div>

                  <div className="flex items-center gap-2">
                    {isAccessible && isAvailable ? (
                      (canDownload ? (
                        <button type="button" onClick={async () => {
                          try {
                            const response = await (await import('../services/fileService')).default.downloadFile(f._id);
                            const blob = new Blob([response.data], { type: response.headers?.['content-type'] || 'application/octet-stream' });
                            const objectUrl = URL.createObjectURL(blob);
                            const anchor = document.createElement('a');
                            anchor.href = objectUrl;
                            anchor.download = f.title || 'material';
                            document.body.appendChild(anchor);
                            anchor.click();
                            anchor.remove();
                            URL.revokeObjectURL(objectUrl);
                          } catch (downloadError) {
                            const message = downloadError?.response?.data?.message || downloadError?.message || 'Unable to download this file.';
                            window.alert(message);
                          }
                        }} className="bg-blue-600 text-white px-3 py-2 rounded">Download</button>
                      ) : null)
                    ) : isAccessible ? (
                      <span className="text-sm text-amber-700 font-medium">Material unavailable</span>
                    ) : (
                      <span className="text-sm text-red-700 font-bold">Not available to this account</span>
                    )}
                  </div>
                </div>

                {user?.role === 'student' && isAccessible && isAvailable && (
                  <CourseMaterialCompletion
                    completed={Boolean(materialProgress?.completed)}
                    saving={savingMaterialId === String(f._id)}
                    disabled={progressLoading || Boolean(progressError) || !materialProgress}
                    onChange={(completed) => updateCompletion(String(f._id), completed)}
                  />
                )}

                {/* Inline file preview - PDF and DOCX are both supported via the authenticated reader */}
                {isAccessible && isAvailable && (
                  <div className="mt-3">
                    <PDFViewer fileUrl={f.fileUrl} fileName={f.title} downloadUrl={`/api/files/download/${f._id}`} canDownload={canDownload} materialId={f._id} />
                  </div>
                )}
                {isAccessible && !isAvailable && (
                  <p className="mt-3 text-sm text-amber-700">
                    This file is unavailable and is excluded from course progress.
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
