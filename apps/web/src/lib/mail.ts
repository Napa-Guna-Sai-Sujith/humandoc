import "server-only";
import nodemailer from "nodemailer";

type MailInput = { to: string; subject: string; html: string; text?: string };

const FROM = process.env.EMAIL_FROM || "HumanDoc <napagunasaisujith@gmail.com>";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] as string);
}

function layout(title: string, body: string): string {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f7f9;padding:32px 0">
    <tr><td align="center">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;padding:36px">
        <tr><td style="font-size:18px;font-weight:600;letter-spacing:-0.01em">HumanDoc</td></tr>
        <tr><td style="padding:18px 0 6px;font-size:20px;font-weight:600">${escapeHtml(title)}</td></tr>
        <tr><td style="font-size:15px;line-height:1.6;color:#374151">${body}</td></tr>
        <tr><td style="padding-top:26px;font-size:12px;color:#9ca3af;border-top:1px solid #f3f4f6;margin-top:26px">
          HumanDoc never trains on your documents. Files are deleted automatically after your retention window.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/**
 * Email delivery via Gmail SMTP (App Password) or Resend REST API.
 */
export async function sendEmail({ to, subject, html, text }: MailInput): Promise<void> {
  const smtpUser = process.env.SMTP_USER || process.env.GMAIL_USER || "napagunasaisujith@gmail.com";
  const smtpPass = (process.env.SMTP_PASSWORD || process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");

  if (smtpPass) {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });
    await transporter.sendMail({
      from: FROM,
      to,
      subject,
      text: text ?? html.replace(/<[^>]+>/g, " "),
      html,
    });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;

  if (apiKey) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [to], subject, html, text: text ?? html.replace(/<[^>]+>/g, " ") }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Email delivery failed (${response.status}): ${detail.slice(0, 300)}`);
    }
    return;
  }

  if (process.env.NODE_ENV === "production") {
    console.warn(`[email] Neither SMTP nor RESEND_API_KEY is configured. Simulating delivery to: ${to}`);
    return;
  }
  console.info(`\n[dev email] to=${to} subject=${subject}\n${text ?? html.replace(/<[^>]+>/g, " ")}\n`);
}

function button(url: string, label: string): string {
  return `<p style="margin:22px 0"><a href="${escapeHtml(url)}" style="background:#111827;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:9px;display:inline-block;font-weight:600">${escapeHtml(label)}</a></p>
  <p style="font-size:12px;color:#6b7280;word-break:break-all">Or paste this link into your browser:<br>${escapeHtml(url)}</p>`;
}

export async function sendVerificationEmail(to: string, url: string): Promise<void> {
  await sendEmail({
    to,
    subject: "Confirm your HumanDoc account",
    html: layout(
      "Confirm your email address",
      `<p>Thanks for signing up. Click the button below to activate your account. The link expires in one hour.</p>${button(url, "Verify email")}`,
    ),
    text: `Confirm your HumanDoc account: ${url} (expires in 1 hour)`,
  });
}

export async function sendPasswordResetEmail(to: string, url: string): Promise<void> {
  await sendEmail({
    to,
    subject: "Reset your HumanDoc password",
    html: layout(
      "Reset your password",
      `<p>We received a request to reset your password. This link expires in 30 minutes. If you did not ask for this, you can ignore this email — your password has not changed.</p>${button(url, "Reset password")}`,
    ),
    text: `Reset your HumanDoc password: ${url} (expires in 30 minutes)`,
  });
}

export async function sendPasswordChangedEmail(to: string): Promise<void> {
  await sendEmail({
    to,
    subject: "Your HumanDoc password was changed",
    html: layout(
      "Password updated",
      `<p>Your password was just updated. All other sessions have been signed out. If this was not you, reset your password immediately and reply to this email.</p>`,
    ),
  });
}

export async function sendDeletionEmail(to: string): Promise<void> {
  await sendEmail({
    to,
    subject: "Your HumanDoc account was deleted",
    html: layout(
      "Account deleted",
      `<p>Your account and every document associated with it have been scheduled for permanent deletion. This cannot be undone.</p>`,
    ),
  });
}
