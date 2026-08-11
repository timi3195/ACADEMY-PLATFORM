import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../utils/auth';

const getErrorMessage = (error, fallback) => error?.body?.message || error?.message || fallback;

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [submittedEmail, setSubmittedEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const { forgotPassword } = useAuth();

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }

    setLoading(true);

    try {
      const response = await forgotPassword(email.trim());
      if (response?.success) {
        setSubmittedEmail(email.trim());
        setSuccess(true);
        setEmail('');
      }
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to send the reset link right now.'));
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
          <p className="auth-card__eyebrow">Need a new password?</p>
          <h1 className="auth-card__title">Forgot your password?</h1>
        </div>
      </div>

      {success && (
        <div className="auth-notice auth-notice--success" role="status">
          <strong>Check your inbox.</strong>
          <span>
            If an account exists for {submittedEmail}, a password reset link has been sent.
          </span>
        </div>
      )}

      {error && (
        <div className="auth-notice auth-notice--error" role="alert">
          {error}
        </div>
      )}

      {!success ? (
        <form onSubmit={handleSubmit} className="auth-form" noValidate>
          <div className="auth-field">
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="student@school.edu.ng"
              autoComplete="email"
              disabled={loading}
              className={error ? 'error' : ''}
            />
          </div>

          <button type="submit" className="auth-button auth-button--primary" disabled={loading}>
            {loading ? 'Sending reset link...' : 'Send reset link'}
          </button>
        </form>
      ) : (
        <div className="auth-actions auth-actions--stacked">
          <Link to="/login" className="auth-button auth-button--primary auth-button--inline">
            Back to login
          </Link>
        </div>
      )}

      <div className="auth-links">
        <Link to="/login">Return to login</Link>
        <Link to="/register">Create an account</Link>
      </div>
    </div>
  );
}
