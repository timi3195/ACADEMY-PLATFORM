import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../utils/auth';

const getErrorMessage = (error, fallback) => error?.body?.message || error?.message || fallback;

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [token, setToken] = useState(searchParams.get('token') || '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const { resetPassword } = useAuth();

  useEffect(() => {
    const nextToken = searchParams.get('token') || '';
    setToken(nextToken);
    if (!nextToken) {
      setError('The reset link is missing a token. Please request a new password reset link.');
    }
  }, [searchParams]);

  const validatePassword = (value) => {
    if (value.length < 8) return 'Password must be at least 8 characters.';
    if (!/[A-Z]/.test(value)) return 'Password must include at least one uppercase letter.';
    if (!/[0-9]/.test(value)) return 'Password must include at least one number.';
    return '';
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (!token) {
      setError('Missing reset token. Please request a new reset link.');
      return;
    }

    if (!password) {
      setError('Please enter a new password.');
      return;
    }

    const passwordValidationError = validatePassword(password);
    if (passwordValidationError) {
      setError(passwordValidationError);
      return;
    }

    if (!confirmPassword) {
      setError('Please confirm your new password.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);

    try {
      const response = await resetPassword(token, password, confirmPassword);
      if (response?.success) {
        setSuccess(true);
        setTimeout(() => navigate('/login'), 2500);
      }
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to reset your password right now.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-card auth-card--narrow">
      <div className="auth-card__header auth-card__header--stacked">
        <div className="auth-brand" aria-label="AcademicHUB home">
          <span className="auth-brand__mark">A</span>
          <span className="auth-brand__text">AcademicHUB</span>
        </div>
        <div>
          <p className="auth-card__eyebrow">Secure your account</p>
          <h1 className="auth-card__title">Reset password</h1>
        </div>
      </div>

      {success && (
        <div className="auth-notice auth-notice--success" role="status">
          Password reset successful. Redirecting you to login...
        </div>
      )}

      {error && (
        <div className="auth-notice auth-notice--error" role="alert">
          {error}
        </div>
      )}

      {!success && (
        <form onSubmit={handleSubmit} className="auth-form" noValidate>
          <div className="auth-field auth-field--with-action">
            <label htmlFor="password">New password</label>
            <div className="auth-input-wrap">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter a new password"
                autoComplete="new-password"
                disabled={loading || !token}
                className={error ? 'error' : ''}
              />
              <button
                type="button"
                className="auth-toggle"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <div className="auth-field auth-field--with-action">
            <label htmlFor="confirmPassword">Confirm password</label>
            <div className="auth-input-wrap">
              <input
                id="confirmPassword"
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Re-enter your new password"
                autoComplete="new-password"
                disabled={loading || !token}
                className={error ? 'error' : ''}
              />
              <button
                type="button"
                className="auth-toggle"
                onClick={() => setShowConfirmPassword((value) => !value)}
                aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
              >
                {showConfirmPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <div className="auth-password-rules" aria-live="polite">
            <strong>Password rules</strong>
            <ul>
              <li className={password.length >= 8 ? 'done' : ''}>At least 8 characters</li>
              <li className={/[A-Z]/.test(password) ? 'done' : ''}>One uppercase letter</li>
              <li className={/[0-9]/.test(password) ? 'done' : ''}>One number</li>
            </ul>
          </div>

          <button type="submit" className="auth-button auth-button--primary" disabled={loading || !token}>
            {loading ? 'Resetting password...' : 'Update password'}
          </button>
        </form>
      )}

      <div className="auth-links">
        <Link to="/login">Back to login</Link>
        <Link to="/forgot-password">Request another reset link</Link>
      </div>
    </div>
  );
}
