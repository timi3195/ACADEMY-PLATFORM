import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPatch } from '../utils/api'

export default function useCourseMaterialProgress(courseId) {
  const [progress, setProgress] = useState(null)
  const [loading, setLoading] = useState(Boolean(courseId))
  const [savingMaterialId, setSavingMaterialId] = useState(null)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!courseId) {
      setProgress(null)
      setLoading(false)
      return undefined
    }

    let active = true
    setLoading(true)
    setError('')
    apiGet(`/api/course-progress/${courseId}`)
      .then((response) => {
        if (active) setProgress(response.progress || null)
      })
      .catch((loadError) => {
        if (active) setError(loadError.message || 'Unable to load course progress.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [courseId, reloadKey])

  const updateCompletion = useCallback(async (materialId, completed) => {
    if (!courseId) return false
    setSavingMaterialId(materialId)
    setError('')
    try {
      const response = await apiPatch(
        `/api/course-progress/${courseId}/materials/${materialId}`,
        { completed }
      )
      setProgress(response.progress || null)
      return true
    } catch (updateError) {
      setError(updateError.message || 'Unable to save course progress.')
      return false
    } finally {
      setSavingMaterialId(null)
    }
  }, [courseId])

  const retry = useCallback(() => setReloadKey((key) => key + 1), [])

  return { progress, loading, savingMaterialId, error, updateCompletion, retry }
}
