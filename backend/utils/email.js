const sgMail = require("@sendgrid/mail");
const nodemailer = require("nodemailer");
const axios = require("axios");
const { logger, buildRequestId } = require("./logger");

/**
 * Configure email transporter
 * Brevo is preferred, followed by SendGrid. SMTP/Ethereal are development-only.
 */
let transporter;
const EMAIL_SEND_TIMEOUT_MS = 15000;
const BREVO_EMAIL_API_URL = "https://api.brevo.com/v3/smtp/email";

const getConfiguredProvider = () => {
  if (process.env.BREVO_API_KEY?.trim()) return "brevo";
  if (process.env.SENDGRID_API_KEY) return "sendgrid";
  if (process.env.NODE_ENV === "production") return "unconfigured";
  if (process.env.SMTP_HOST) return "smtp";
  return "ethereal";
};

const getSafeProviderError = (error) => {
  const statusCode = Number(error?.response?.status || error?.response?.statusCode || error?.statusCode || 0);
  const rawCode = String(error?.code || statusCode || "");
  const code = /^[A-Za-z0-9_-]{1,40}$/.test(rawCode) ? rawCode : "provider_error";

  if (["ETIMEDOUT", "ESOCKETTIMEDOUT", "ECONNABORTED", "EMAIL_SEND_TIMEOUT"].includes(code) ||
      statusCode === 408 || statusCode === 504) {
    return { code, outcome: "timeout_delivery_unknown", description: "The provider timed out; acceptance is unknown." };
  }
  if (code === "EAUTH" || statusCode === 401 || statusCode === 403) {
    return { code, outcome: "provider_authentication_failed", description: "The provider rejected the configured credentials." };
  }
  if (code === "EENVELOPE" || code === "SMTP_RECIPIENT_NOT_ACCEPTED" ||
      statusCode === 550 || statusCode === 553) {
    return { code, outcome: "provider_rejected_request", description: "The provider rejected the sender or recipient address." };
  }
  if (statusCode === 400 || statusCode === 422) {
    return { code, outcome: "provider_rejected_request", description: "The provider rejected the message request or sender configuration." };
  }
  if (statusCode === 429) {
    return { code, outcome: "provider_rate_limited", description: "The provider rate-limited the message request." };
  }
  if (statusCode >= 500) {
    return { code, outcome: "provider_unavailable", description: "The provider reported a server error." };
  }
  if (code === "EMAIL_CONFIGURATION") {
    return { code, outcome: "configuration_missing", description: "Email delivery is not configured." };
  }
  if (code === "FRONTEND_URL_CONFIGURATION") {
    return { code, outcome: "configuration_missing", description: "FRONTEND_URL must be configured to send verification links." };
  }
  return { code, outcome: "provider_error", description: "The provider failed to accept the message." };
};

const getSafeMessageId = (messageId) =>
  typeof messageId === "string" && messageId.length <= 200 &&
  /^[A-Za-z0-9._:@<>-]+$/.test(messageId) ? messageId : "accepted";

const parseSender = (from) => {
  if (typeof from !== "string" || !from.trim() ||
      (process.env.NODE_ENV === "production" && !process.env.EMAIL_FROM?.trim())) {
    const error = new Error("A valid EMAIL_FROM sender is required.");
    error.code = "EMAIL_CONFIGURATION";
    throw error;
  }

  const formatted = from.trim().match(/^([^<>]*)<([^<>]+)>$/);
  const email = formatted ? formatted[2].trim() : from.trim();
  const name = formatted ? formatted[1].trim() : "";
  const emailPattern = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;

  if ((formatted && (!name || /[\r\n]/.test(name))) ||
      (!formatted && /[<>]/.test(email)) ||
      email.length > 254 || email.includes("..") || !emailPattern.test(email)) {
    const error = new Error("A valid EMAIL_FROM sender is required.");
    error.code = "EMAIL_CONFIGURATION";
    throw error;
  }

  return { email, ...(name ? { name } : {}) };
};

const withTimeout = (promise, timeoutMs) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    const error = new Error("Email provider timed out.");
    error.code = "EMAIL_SEND_TIMEOUT";
    reject(error);
  }, timeoutMs);

  promise.then(
    (value) => {
      clearTimeout(timer);
      resolve(value);
    },
    (error) => {
      clearTimeout(timer);
      reject(error);
    }
  );
});

const initializeMailer = async () => {
  if (process.env.BREVO_API_KEY?.trim()) {
    transporter = null;
  } else if (process.env.SENDGRID_API_KEY) {
    transporter = null;
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  } else if (process.env.NODE_ENV === "production") {
    const error = new Error("Email delivery is not configured. Set BREVO_API_KEY or SENDGRID_API_KEY.");
    error.code = "EMAIL_CONFIGURATION";
    throw error;
  } else if (process.env.SMTP_HOST) {
    const hasSmtpUser = Boolean(process.env.SMTP_USER);
    const hasSmtpPassword = Boolean(process.env.SMTP_PASS);
    if (hasSmtpUser !== hasSmtpPassword) {
      const error = new Error("SMTP_USER and SMTP_PASS must be configured together.");
      error.code = "EMAIL_CONFIGURATION";
      throw error;
    }

    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT || 587,
      secure: process.env.SMTP_SECURE === "true",
      ...(hasSmtpUser ? { auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      } } : {}),
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000
    });
  } else {
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000
    });
  }

  return transporter;
};

const deliverTransactionalEmail = async (mailOptions, provider, timeoutMs = EMAIL_SEND_TIMEOUT_MS) => {
  const sender = parseSender(mailOptions.from);
  if (provider === "brevo") {
    const response = await withTimeout(axios.post(BREVO_EMAIL_API_URL, {
      sender,
      to: [{ email: mailOptions.to }],
      subject: mailOptions.subject,
      htmlContent: mailOptions.html
    }, {
      headers: {
        "api-key": process.env.BREVO_API_KEY.trim(),
        "accept": "application/json",
        "content-type": "application/json"
      },
      timeout: timeoutMs
    }), timeoutMs);

    const statusCode = Number(response?.status || 0);
    if (statusCode < 200 || statusCode >= 300) {
      const error = new Error("Brevo did not accept the message.");
      error.statusCode = statusCode;
      throw error;
    }

    return {
      provider,
      statusCode,
      messageId: getSafeMessageId(response?.data?.messageId)
    };
  }

  if (provider === "sendgrid") {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    const result = await withTimeout(sgMail.send(mailOptions), timeoutMs);
    const statusCode = Number(result?.[0]?.statusCode || 0);
    if (statusCode < 200 || statusCode >= 300) {
      const error = new Error("SendGrid did not accept the message.");
      error.statusCode = statusCode;
      throw error;
    }

    return {
      provider,
      statusCode,
      messageId: getSafeMessageId(result?.[0]?.headers?.["x-message-id"])
    };
  }

  if (provider === "unconfigured") {
    const error = new Error("Email delivery is not configured.");
    error.code = "EMAIL_CONFIGURATION";
    throw error;
  }

  await initializeMailer();
  const info = await withTimeout(transporter.sendMail(mailOptions), timeoutMs);
  const acceptedRecipients = Array.isArray(info?.accepted) ? info.accepted : [];
  const recipientAccepted = acceptedRecipients.some((recipient) =>
    String(recipient).toLowerCase() === String(mailOptions.to).toLowerCase()
  );
  if (!recipientAccepted) {
    const error = new Error("SMTP did not accept the recipient.");
    error.code = "SMTP_RECIPIENT_NOT_ACCEPTED";
    throw error;
  }

  return { provider, messageId: getSafeMessageId(info?.messageId) };
};

/**
 * Send email verification email
 */
const sendVerificationEmail = async (email, token, userName) => {
  // Skip email in development if configured
  if (process.env.NODE_ENV === "development" && process.env.SKIP_EMAIL_IN_DEV === "true") {
    logger.info("verification_email_skipped", {
      requestId: buildRequestId(),
      provider: "development_skip",
      outcome: "skipped"
    });
    return { success: true, messageId: "dev-mode", skipped: true };
  }

  const requestId = buildRequestId();
  const provider = getConfiguredProvider();
  try {
    if (process.env.NODE_ENV === "production" && !process.env.FRONTEND_URL) {
      const error = new Error("FRONTEND_URL must be configured to send verification links.");
      error.code = "FRONTEND_URL_CONFIGURATION";
      throw error;
    }

    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;
    const fromEmail = process.env.EMAIL_FROM || (process.env.NODE_ENV === "production" ? "" : "noreply@academyplatform.com");
    const mailOptions = {
      from: fromEmail,
      to: email,
      subject: "Verify Your Email - Academy Platform",
      html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Welcome to Academy Platform, ${userName}!</h2>
        <p>Thank you for signing up. Please verify your email address to activate your account.</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verificationUrl}" style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
            Verify Email
          </a>
        </div>
        
        <p>Or copy this link: <a href="${verificationUrl}">${verificationUrl}</a></p>
        
        <p style="color: #666; font-size: 12px;">
          This link will expire in 24 hours.
          If you didn't create this account, please ignore this email.
        </p>
      </div>
    `
    };

    logger.info("verification_email_send_attempted", { requestId, provider });
    const result = await deliverTransactionalEmail(mailOptions, provider);
    logger.info("verification_email_provider_accepted", {
      requestId,
      provider,
      providerStatusCode: result.statusCode,
      providerMessageId: result.messageId,
      outcome: "accepted_by_provider",
      delivered: false
    });
    return {
      success: true,
      accepted: true,
      delivered: false,
      outcome: "accepted_by_provider",
      messageId: result.messageId
    };
  } catch (error) {
    const safeError = getSafeProviderError(error);
    logger.error("verification_email_provider_failed", {
      requestId,
      provider,
      code: safeError.code,
      outcome: safeError.outcome,
      description: safeError.description
    });
    return { success: false, error: safeError.description, outcome: safeError.outcome };
  }
};

/**
 * Send password reset email
 */
const sendPasswordResetEmail = async (
  email,
  token,
  userName,
  requestId,
  timeoutMs = EMAIL_SEND_TIMEOUT_MS
) => {
  // Skip email in development if configured
  if (process.env.NODE_ENV === "development" && process.env.SKIP_EMAIL_IN_DEV === "true") {
    logger.info("password_reset_email_skipped", {
      requestId: requestId || buildRequestId(),
      provider: "development_skip",
      outcome: "skipped"
    });
    return { success: true, messageId: "dev-mode", skipped: true };
  }

  const correlationId = requestId || buildRequestId();
  let provider = getConfiguredProvider();
  const configurationComplete = provider !== "unconfigured" &&
    (provider !== "smtp" || Boolean(process.env.SMTP_HOST) &&
      Boolean(process.env.SMTP_USER) && Boolean(process.env.SMTP_PASS)) &&
    Boolean(process.env.FRONTEND_URL);
  logger.info("password_reset_email_send_started", {
    requestId: correlationId,
    provider,
    configurationComplete,
    senderConfigured: Boolean(process.env.EMAIL_FROM || "noreply@academyplatform.com")
  });

  try {
    if (!process.env.FRONTEND_URL) {
      const error = new Error("FRONTEND_URL is not configured.");
      error.code = "EMAIL_CONFIGURATION";
      throw error;
    }

    if (provider === "unconfigured" ||
        (provider === "smtp" && (!process.env.SMTP_USER || !process.env.SMTP_PASS))) {
      const error = new Error("Email delivery is not configured.");
      error.code = "EMAIL_CONFIGURATION";
      throw error;
    }

    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
    const fromEmail = process.env.EMAIL_FROM || (process.env.NODE_ENV === "production" ? "" : "noreply@academyplatform.com");
    const mailOptions = {
      from: fromEmail,
      to: email,
      subject: "Password Reset Request - Academy Platform",
      html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Password Reset Request</h2>
        <p>Hi ${userName},</p>
        <p>We received a request to reset your password. Click the link below to create a new password.</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetUrl}" style="background-color: #28a745; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
            Reset Password
          </a>
        </div>
        
        <p>Or copy this link: <a href="${resetUrl}">${resetUrl}</a></p>
        
        <p style="color: #666; font-size: 12px;">
          This link will expire in 1 hour.
          If you didn't request this, please ignore this email and your password will remain unchanged.
        </p>
      </div>
    `
    };

    logger.info("password_reset_email_send_attempted", {
      requestId: correlationId,
      provider
    });
    const result = await deliverTransactionalEmail(mailOptions, provider, timeoutMs);
    logger.info("password_reset_email_provider_accepted", {
      requestId: correlationId,
      provider,
      providerStatusCode: result.statusCode,
      providerMessageId: result.messageId,
      outcome: "accepted_by_provider",
      delivered: false
    });
    return {
      success: true,
      accepted: true,
      delivered: false,
      outcome: "accepted_by_provider",
      messageId: result.messageId
    };
  } catch (error) {
    const safeError = getSafeProviderError(error);
    logger.error("password_reset_email_provider_failed", {
      requestId: correlationId,
      provider,
      code: safeError.code,
      outcome: safeError.outcome,
      description: safeError.description
    });
    return {
      success: false,
      accepted: false,
      delivered: false,
      outcome: safeError.outcome,
      error: safeError.description
    };
  }
};

/**
 * Send subscription confirmation email
 */
const sendSubscriptionConfirmation = async (email, userName, plan, semester, expiresAt) => {
  const provider = getConfiguredProvider();
  const fromEmail = process.env.EMAIL_FROM || (process.env.NODE_ENV === "production" ? "" : "noreply@academyplatform.com");

  const mailOptions = {
    from: fromEmail,
    to: email,
    subject: "Subscription Activated - Academy Platform",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>🎉 Subscription Activated!</h2>
        <p>Hi ${userName},</p>
        <p>Thank you for upgrading. Your subscription is now active.</p>
        
        <div style="background-color: #f0f0f0; padding: 20px; border-radius: 5px; margin: 20px 0;">
          <p><strong>Plan:</strong> ${plan.charAt(0).toUpperCase() + plan.slice(1)}</p>
          <p><strong>Semester:</strong> ${semester}</p>
          <p><strong>Expires:</strong> ${new Date(expiresAt).toLocaleDateString()}</p>
        </div>
        
        <p>You now have access to:</p>
        <ul>
          <li>✅ Premium quiz content</li>
          <li>✅ AI-generated quizzes</li>
          <li>✅ Advanced analytics</li>
          <li>✅ Course downloads</li>
        </ul>
        
        <p>Happy learning!</p>
      </div>
    ` 
  };

  try {
    const result = await deliverTransactionalEmail(mailOptions, provider);
    return { success: true, accepted: true, delivered: false, messageId: result.messageId };
  } catch (error) {
    const safeError = getSafeProviderError(error);
    logger.error("subscription_email_provider_failed", {
      requestId: buildRequestId(),
      provider,
      code: safeError.code,
      outcome: safeError.outcome,
      description: safeError.description
    });
    return { success: false, error: safeError.description };
  }
};

/**
 * Send quiz result email
 */
const sendQuizResultEmail = async (email, userName, score, total, topic) => {
  const provider = getConfiguredProvider();
  const percentage = Math.round((score / total) * 100);

  const mailOptions = {
    from: process.env.EMAIL_FROM || (process.env.NODE_ENV === "production" ? "" : "noreply@academyplatform.com"),
    to: email,
    subject: `Quiz Result: ${topic} - Academy Platform`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Quiz Result for ${topic}</h2>
        <p>Hi ${userName},</p>
        <p>You just completed a quiz. Here's your result:</p>
        
        <div style="background-color: ${percentage >= 70 ? "#d4edda" : "#f8d7da"}; padding: 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid ${percentage >= 70 ? "#28a745" : "#dc3545"};">
          <h3 style="margin: 0; color: ${percentage >= 70 ? "#28a745" : "#dc3545"};">
            ${percentage}%
          </h3>
          <p style="margin: 10px 0 0 0;">Score: ${score}/${total}</p>
        </div>
        
        <p>
          ${percentage >= 70 
            ? "🎉 Great job! You passed the quiz. Keep up the excellent work!" 
            : "📚 You can do better! Review the material and try again."}
        </p>
      </div>
    `
  };

  try {
    const result = await deliverTransactionalEmail(mailOptions, provider);
    return { success: true, accepted: true, delivered: false, messageId: result.messageId };
  } catch (error) {
    const safeError = getSafeProviderError(error);
    logger.error("quiz_result_email_provider_failed", {
      requestId: buildRequestId(),
      provider,
      code: safeError.code,
      outcome: safeError.outcome,
      description: safeError.description
    });
    return { success: false, error: safeError.description };
  }
};

module.exports = {
  initializeMailer,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendSubscriptionConfirmation,
  sendQuizResultEmail
};
