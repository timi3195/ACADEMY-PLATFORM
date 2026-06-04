import React, { useEffect, useState } from 'react'
import { apiGet } from '../utils/api'

export default function PastQuestions() {
  const [questions, setQuestions] = useState([])
  const [selectedYear, setSelectedYear] = useState('')

  const currentYear = new Date().getFullYear()
  const years = Array.from({ length: 5 }, (_, i) => (currentYear - i).toString())

  useEffect(()=>{ fetchQuestions() }, [])

  const isObjectiveQuestion = (q) => {
    if (q.options && q.options.length > 0) return true
    if (Array.isArray(q.subQuestions) && q.subQuestions.some(sub => Array.isArray(sub.options) && sub.options.length > 0)) return true
    return false
  }

  const filteredQuestions = questions
    .filter((q) => years.includes(q.year || ''))
    .filter((q) => !selectedYear || q.year === selectedYear)

  const objectiveQuestions = filteredQuestions.filter(isObjectiveQuestion)
  const theoryQuestions = filteredQuestions.filter((q) => !isObjectiveQuestion(q))

  async function fetchQuestions(){
    try{
      const res = await apiGet('/api/questions')
      setQuestions(res.questions || [])
      if (!selectedYear) {
        setSelectedYear(currentYear.toString())
      }
    }catch(err){
      console.error(err)
      alert('Failed to load questions')
    }
  }

  return (
    <div className="page">
      <h2>Past Questions</h2>
      <p className="text-sm text-gray-600 mb-4">Past questions are available for the last 5 years. Use the year filter to narrow results.</p>

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

      <section className="mb-8">
        <h3 className="text-xl font-bold text-blue-700 mb-4">Objective Questions</h3>
        {objectiveQuestions.length === 0 ? (
          <p className="text-gray-600">No objective questions are available yet.</p>
        ) : (
          <div className="space-y-4">
            {objectiveQuestions.map((q) => (
              <div key={q._id} className="p-4 border border-gray-200 rounded-lg bg-white shadow-sm">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-3">
                  <strong className="text-lg text-gray-900">{q.question}</strong>
                  <span className="text-xs text-gray-500">
                    {q.course?.title || q.course?.code || 'Unknown course'} • {q.year || 'N/A'} {q.session ? `• ${q.session}` : ''}
                  </span>
                </div>

                <div className="text-sm text-gray-600 mb-3">Topic: {q.topic || 'General'}</div>

                {q.subQuestions && q.subQuestions.length > 0 ? (
                  <div className="space-y-4 pl-4 border-l-4 border-blue-100">
                    {q.subQuestions.map((sub, idx) => (
                      <div key={idx} className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                        <div className="mb-2">
                          <p className="font-semibold text-gray-800">{sub.label || `Part ${idx + 1}`}</p>
                          <p className="text-gray-700">{sub.question}</p>
                        </div>
                        {sub.options && sub.options.length > 0 ? (
                          <div className="space-y-2">
                            {sub.options.map((opt, optIdx) => (
                              <div key={optIdx} className="flex items-center gap-3">
                                <input type="radio" name={`pq-${q._id}-sub-${idx}`} className="w-4 h-4" />
                                <span className="text-gray-700">{opt}</span>
                              </div>
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
                      q.options.map((opt, optIdx) => (
                        <div key={optIdx} className="flex items-center gap-3">
                          <input type="radio" name={`pq-${q._id}`} className="w-4 h-4" />
                          <span className="text-gray-700">{opt}</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-gray-500">No options available.</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="text-xl font-bold text-amber-700 mb-4">Theory Questions</h3>
        {theoryQuestions.length === 0 ? (
          <p className="text-gray-600">No theory questions are available yet.</p>
        ) : (
          <div className="space-y-4">
            {theoryQuestions.map((q) => (
              <div key={q._id} className="p-4 border border-gray-200 rounded-lg bg-slate-50">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-3">
                  <strong className="text-lg text-gray-900">{q.question}</strong>
                  <span className="text-xs text-gray-500">
                    {q.course?.title || q.course?.code || 'Unknown course'} • {q.year || 'N/A'} {q.session ? `• ${q.session}` : ''}
                  </span>
                </div>
                <div className="text-sm text-gray-600 mb-3">Topic: {q.topic || 'General'}</div>
                <p className="text-gray-700">{q.explanation || 'This question is best answered as a theory or long-form response.'}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
