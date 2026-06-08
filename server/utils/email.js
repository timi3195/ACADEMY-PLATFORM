const sgMail = require("@sendgrid/mail");
const nodemailer = require("nodemailer");

/**
 * Configure email transporter
 * Uses SendGrid Web API when SENDGRID_API_KEY is present (preferred - uses HTTPS).
 * Uses standard SMTP when SMTP_HOST is set.
 * Uses ethereal for local development otherwise.
 */
let transporter;
let usesSendGridAPI = false;

const initializeMailer = async () => {
  if (process.env.SENDGRID_API_KEY) {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    usesSendGridAPI = true;
    console.log("📧 Email transporter initialized using SendGrid Web API (HTTPS)");
  } else if (process.env.SMTP_HOST) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT || 587,
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000
    });
    console.log("📧 Email transporter initialized using SMTP host", process.env.SMTP_HOST);
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
    console.log("📧 Email transporter initialized using Ethereal test account");
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

  try {
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
const sendPasswordResetEmail = async (email, token, userName) => {
  // Skip email in development if configured
  if (process.env.NODE_ENV === "development" && process.env.SKIP_EMAIL_IN_DEV === "true") {
    console.log(`📧 [DEV MODE] Password reset link for ${email}: ${process.env.FRONTEND_URL}/reset-password?token=${token}`);
    return { success: true, messageId: "dev-mode", skipped: true };
  }

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

  try {
    if (usesSendGridAPI) {
      console.log(`📧 Sending password reset email via SendGrid API to ${email}...`);
      const result = await sgMail.send(mailOptions);
      console.log("✅ Password reset email sent via SendGrid:", result[0].statusCode);
      return { success: true, messageId: result[0].headers["x-message-id"] || "sent" };
    } else {
      if (!transporter) {
        await initializeMailer();
      }
      console.log(`📧 Sending password reset email via SMTP to ${email}...`);
      const info = await transporter.sendMail(mailOptions);
      console.log("✅ Password reset email sent:", info.messageId);
      
      if (process.env.NODE_ENV !== "production") {
        console.log("📋 Preview URL:", nodemailer.getTestMessageUrl(info));
      }

      return { success: true, messageId: info.messageId };
    }
  } catch (error) {
    console.error("❌ Failed to send password reset email:", error.message || error);
    return { success: false, error: error.message || error };
  }
};

/**
 * Send subscription confirmation email
 */
const sendSubscriptionConfirmation = async (email, userName, plan, semester, expiresAt) => {
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
      if (!transporter) {
        await initializeMailer();
      }
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
  if (!transporter) {
    await initializeMailer();
  }

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
