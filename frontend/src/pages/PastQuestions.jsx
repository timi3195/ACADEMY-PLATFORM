import React, { useEffect, useState } from 'react'
import { apiGet } from '../utils/api'
import EmptyState from '../components/EmptyState'
import ErrorState from '../components/ErrorState'
import PDFViewer from '../components/PDFViewer'

export default function PastQuestions() {
  const [papers, setPapers] = useState([])
  const [selectedYear, setSelectedYear] = useState('')
  const [openPaperId, setOpenPaperId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const currentYear = new Date().getFullYear()
  const years = Array.from({ length: 5 }, (_, i) => (currentYear - i).toString())

  useEffect(() => {
    fetchQuestions()
  }, [])

  const isObjectiveQuestion = (q) => {
    if (q.options && q.options.length > 0) return true
    if (Array.isArray(q.subQuestions) && q.subQuestions.some(sub => Array.isArray(sub.options) && sub.options.length > 0)) return true
    return false
  }

  async function fetchQuestions() {
    setLoading(true)
    setError('')
    try {
      const res = await apiGet('/api/files/past-questions')
      setPapers(res.papers || [])
      if (!selectedYear) {
        setSelectedYear(currentYear.toString())
      }
    } catch (err) {
      console.error(err)
      setError(err.message || 'Unable to load past questions right now.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page past-questions-page">
      <h2>Past Questions</h2>
      <p className="text-sm text-gray-600 mb-4">Browse past-question papers uploaded by the administrator for your courses.</p>

      {error && <ErrorState message={error} />}

      <div className="mb-6 max-w-sm">
        <label className="block text-sm font-semibold text-gray-700 mb-2">Select year</label>
        <select
          value={selectedYear}
          onChange={(e) => setSelectedYear(e.target.value)}
          className="w-full p-3 border border-gray-300 rounded-lg"
        >
          <option value="">All recent years</option>
          {years.map((year) => (
            <option key={year} value={year}>{year}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="text-sm text-gray-600">Loading past questions…</p>
      ) : papers.filter((paper) => !selectedYear || paper.examinationYear === selectedYear).length === 0 ? (
        <EmptyState title="No past question papers available" description="There are no uploaded papers for this selection yet." icon="📝" />
      ) : (
        <div className="past-questions-list grid gap-4">
          {papers.filter((paper) => !selectedYear || paper.examinationYear === selectedYear).map((paper) => (
            <article key={paper._id} className="past-question-card p-4 border border-gray-200 rounded-lg bg-white shadow-sm">
              <div className="past-question-card-header flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">{paper.title}</h3>
                  <p className="text-sm text-gray-600">{paper.course?.code || paper.course?.title} • {paper.level} • {paper.semester} • {paper.examinationYear}</p>
                </div>
                <button
                  type="button"
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg"
                  aria-expanded={openPaperId === paper._id}
                  onClick={() => setOpenPaperId((currentId) => currentId === paper._id ? '' : paper._id)}
                >
                  {openPaperId === paper._id ? 'Close Past Question' : 'Open Past Question'}
                </button>
              </div>
              {openPaperId === paper._id && (
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
  )
}
