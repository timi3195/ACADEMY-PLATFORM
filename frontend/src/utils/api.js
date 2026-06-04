const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000'

function getAccessToken() {
  return localStorage.getItem('accessToken')
}

function setAccessToken(token) {
  if (token) localStorage.setItem('accessToken', token)
  else localStorage.removeItem('accessToken')
}

/**
 * Make API request with automatic token refresh on 401
 */
async function request(path, options = {}) {
  const headers = options.headers || {}
  if (!headers['Content-Type'] && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }
  
  const token = getAccessToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  // Include credentials to send/receive cookies
  const fetchOptions = {
    ...options,
    headers,
    credentials: 'include' // This is crucial for HTTP-only cookies
  }

  let res = await fetch(API_BASE + path, fetchOptions)

  // If 401 Unauthorized, try to refresh the token
  if (res.status === 401 && path !== '/api/auth/refresh') {
    try {
      const refreshRes = await fetch(API_BASE + '/api/auth/refresh', {
        method: 'POST',
        credentials: 'include'
      })

      if (refreshRes.ok) {
        const refreshData = await refreshRes.json()
        if (refreshData.accessToken) {
          setAccessToken(refreshData.accessToken)
          
          // Retry original request with new token
          headers['Authorization'] = `Bearer ${refreshData.accessToken}`
          res = await fetch(API_BASE + path, {
            ...options,
            headers,
            credentials: 'include'
          })
        }
      }
    } catch (err) {
      // If refresh fails, let it continue to handle original error
      console.error('Token refresh failed:', err)
    }
  }

  const text = await res.text()
  let data
  try { data = text ? JSON.parse(text) : {} } catch (e) { data = { raw: text } }

  if (!res.ok) {
    const msg = data && data.message ? data.message : res.statusText
    const err = new Error(msg)
    err.status = res.status
    err.body = data
    throw err
  }

  return data
}

export async function apiGet(path) { return request(path, { method: 'GET' }) }
export async function apiPost(path, body) { return request(path, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body) }) }
export async function apiPut(path, body) { return request(path, { method: 'PUT', body: body instanceof FormData ? body : JSON.stringify(body) }) }
export async function apiDelete(path) { return request(path, { method: 'DELETE' }) }
export { API_BASE, getAccessToken, setAccessToken }
