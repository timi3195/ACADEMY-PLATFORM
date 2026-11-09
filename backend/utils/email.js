const sgMail = require("@sendgrid/mail");
const nodemailer = require("nodemailer");
const { logger, buildRequestId } = require("./logger");

/**
 * Configure email transporter
 * Uses SendGrid Web API when SENDGRID_API_KEY is present (preferred - uses HTTPS).
 * Uses standard SMTP when SMTP_HOST is set.
 * Uses Ethereal only for non-production environments without a configured provider.
 */
let transporter;
let usesSendGridAPI = false;
const EMAIL_SEND_TIMEOUT_MS = 15000;

const getConfiguredProvider = () => {
  if (process.env.SENDGRID_API_KEY) return "sendgrid";
  if (process.env.SMTP_HOST) return "smtp";
  return process.env.NODE_ENV === "production" ? "unconfigured" : "ethereal";
};

const getSafeProviderError = (error) => {
  const rawCode = String(error?.code || error?.response?.statusCode || error?.statusCode || "");
  const code = /^[A-Za-z0-9_-]{1,40}$/.test(rawCode) ? rawCode : "provider_error";
  const statusCode = Number(error?.response?.statusCode || error?.statusCode || 0);

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
    return { code, outcome: "configuration_missing", description: "Required email configuration is missing or incomplete." };
  }
  return { code, outcome: "provider_error", description: "The provider failed to accept the message." };
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
  if (process.env.SENDGRID_API_KEY) {
    transporter = null;
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    usesSendGridAPI = true;
  } else if (process.env.SMTP_HOST) {
    const hasSmtpUser = Boolean(process.env.SMTP_USER);
    const hasSmtpPassword = Boolean(process.env.SMTP_PASS);
    if (hasSmtpUser !== hasSmtpPassword) {
      const error = new Error("SMTP_USER and SMTP_PASS must be configured together.");
      error.code = "EMAIL_CONFIGURATION";
      throw error;
    }

    usesSendGridAPI = false;
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
    if (process.env.NODE_ENV === "production") {
      const error = new Error("Email delivery is not configured. Set SENDGRID_API_KEY or SMTP_HOST.");
      error.code = "EMAIL_CONFIGURATION";
      throw error;
    }

    usesSendGridAPI = false;
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

/**
 * Send email verification email
 */
const sendVerificationEmail = async (email, token, userName) => {
  // Skip email in development if configured
  if (process.env.NODE_ENV === "development" && process.env.SKIP_EMAIL_IN_DEV === "true") {
    console.log(`📧 [DEV MODE] Verification link for ${email}: ${process.env.FRONTEND_URL}/verify-email?token=${token}`);
    return { success: true, messageId: "dev-mode", skipped: true };
  }

  try {
    if (process.env.NODE_ENV === "production" && !process.env.FRONTEND_URL) {
      throw new Error("FRONTEND_URL must be configured to send verification links.");
    }

    await initializeMailer();

    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;
    const fromEmail = process.env.EMAIL_FROM || "noreply@academyplatform.com";

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

    if (usesSendGridAPI) {
      console.log(`📧 Sending verification email via SendGrid API to ${email}...`);
      const result = await sgMail.send(mailOptions);
      console.log("✅ Verification email sent via SendGrid:", result[0].statusCode);
      return { success: true, messageId: result[0].headers["x-message-id"] || "sent" };
    } else {
      if (!transporter) {
        await initializeMailer();
      }
      console.log(`📧 Sending verification email via SMTP to ${email}...`);
      const info = await transporter.sendMail(mailOptions);
      console.log("✉️ Verification email sent:", info.messageId);
      
      if (process.env.NODE_ENV !== "production") {
        console.log("Preview URL:", nodemailer.getTestMessageUrl(info));
      }

      return { success: true, messageId: info.messageId };
    }
  } catch (error) {
    console.error("❌ Failed to send verification email:", error.message || error);
    return { success: false, error: error.message || error };
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
    Boolean(process.env.FRONTEND_URL) &&
    Boolean(process.env.EMAIL_FROM);
  logger.info("password_reset_email_send_started", {
    requestId: correlationId,
    provider,
    configurationComplete,
    senderConfigured: Boolean(process.env.EMAIL_FROM)
  });

  try {
    if (!process.env.FRONTEND_URL) {
      const error = new Error("FRONTEND_URL is not configured.");
      error.code = "EMAIL_CONFIGURATION";
      throw error;
    }

    await initializeMailer();
    provider = usesSendGridAPI ? "sendgrid" : process.env.SMTP_HOST ? "smtp" : "ethereal";
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
    const fromEmail = process.env.EMAIL_FROM || "noreply@academyplatform.com";
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

    let sendPromise;
    if (usesSendGridAPI) {
      sendPromise = sgMail.send(mailOptions);
    } else {
      logger.info("password_reset_email_send_attempted", {
        requestId: correlationId,
        provider
      });
      sendPromise = transporter.sendMail(mailOptions);
    }
    const result = await withTimeout(sendPromise, timeoutMs);

    if (usesSendGridAPI) {
      const statusCode = Number(result?.[0]?.statusCode || 0);
      if (statusCode < 200 || statusCode >= 300) {
        const error = new Error("SendGrid did not accept the message.");
        error.code = String(statusCode || "provider_error");
        error.statusCode = statusCode;
        throw error;
      }

      logger.info("password_reset_email_provider_accepted", {
        requestId: correlationId,
        provider,
        providerStatusCode: statusCode,
        outcome: "accepted_by_provider",
        delivered: false
      });
      return {
        success: true,
        accepted: true,
        delivered: false,
        outcome: "accepted_by_provider",
        messageId: result?.[0]?.headers?.["x-message-id"] || "accepted"
      };
    }

    const acceptedRecipients = Array.isArray(result?.accepted) ? result.accepted : [];
    const accepted = acceptedRecipients.some((recipient) =>
      String(recipient).toLowerCase() === String(email).toLowerCase()
    );
    if (!accepted) {
      const error = new Error("SMTP did not report the recipient as accepted.");
      error.code = "SMTP_RECIPIENT_NOT_ACCEPTED";
      throw error;
    }

    logger.info("password_reset_email_provider_accepted", {
      requestId: correlationId,
      provider,
      outcome: "accepted_by_provider",
      delivered: false
    });
    return {
      success: true,
      accepted: true,
      delivered: false,
      outcome: "accepted_by_provider",
      messageId: result.messageId || "accepted"
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
  await initializeMailer();

  const fromEmail = process.env.EMAIL_FROM || "noreply@academyplatform.com";

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
    if (usesSendGridAPI) {
      console.log(`📧 Sending subscription email via SendGrid API to ${email}...`);
      const result = await sgMail.send(mailOptions);
      console.log("✅ Subscription email sent via SendGrid:", result[0].statusCode);
      return { success: true, messageId: result[0].headers["x-message-id"] || "sent" };
    } else {
      const info = await transporter.sendMail(mailOptions);
      console.log("✉️ Subscription confirmation email sent:", info.messageId);
      return { success: true, messageId: info.messageId };
    }
  } catch (error) {
    console.error("❌ Failed to send subscription email:", error.message || error);
    return { success: false, error: error.message || error };
  }
};

/**
 * Send quiz result email
 */
const sendQuizResultEmail = async (email, userName, score, total, topic) => {
  await initializeMailer();

  const percentage = Math.round((score / total) * 100);

  const mailOptions = {
    from: process.env.EMAIL_FROM || "noreply@academyplatform.com",
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
    const info = await transporter.sendMail(mailOptions);
    console.log("✉️ Quiz result email sent:", info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error("❌ Failed to send quiz result email:", error);
    return { success: false, error: error.message };
  }
};

module.exports = {
  initializeMailer,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendSubscriptionConfirmation,
  sendQuizResultEmail
};
