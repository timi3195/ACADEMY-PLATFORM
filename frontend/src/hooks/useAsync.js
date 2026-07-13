import { useCallback, useState } from 'react';

export function useAsync(callback) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const execute = useCallback(async (...args) => {
    setLoading(true);
    setError('');
    try {
      return await callback(...args);
    } catch (err) {
      setError(err.message || 'Something went wrong');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [callback]);

  return { loading, error, execute };
}
