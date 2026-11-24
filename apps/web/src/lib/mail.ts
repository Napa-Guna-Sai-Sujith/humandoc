import "server-only";
import nodemailer from "nodemailer";

type MailInput = { to: string; subject: string; html: string; text?: string };

const FROM = process.env.EMAIL_FROM || process.env.SMTP_USER || "HumanDoc <no-reply@humandoc.local>";

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
 * Universal email delivery:
 * 1. Supports Gmail / SMTP via nodemailer (using Google App Passwords)
 * 2. Supports Resend REST API
 * 3. Falls back to server logging in development if neither is configured
 */
export async function sendEmail({ to, subject, html, text }: MailInput): Promise<void> {
  const smtpUser = process.env.SMTP_USER || process.env.GMAIL_USER || "napagunasaisujith@gmail.com";
  const smtpPass = (process.env.SMTP_PASSWORD || process.env.GMAIL_APP_PASSWORD || "ipnckxgruffvcuss").replace(/\s+/g, "");

  // 1. Send via Gmail / SMTP if configured
  if (smtpUser && smtpPass) {
    try {
      const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });

      await new Promise<void>((resolve, reject) => {
        transporter.sendMail(
          {
            from: `HumanDoc <${smtpUser}>`,
            to,
            subject,
            html,
            text: text ?? html.replace(/<[^>]+>/g, " "),
          },
          (err, info) => {
            if (err) {
              console.error("[mail] SMTP Error:", err);
              reject(err);
            } else {
              console.info("[mail] Email sent successfully:", info.messageId);
              resolve();
            }
          },
        );
      });
      return;
    } catch (smtpErr) {
      console.error("[mail] SMTP delivery attempt failed:", (smtpErr as Error).message);
    }
  }

  // 2. Send via Resend if API key is provided
  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: FROM, to: [to], subject, html, text: text ?? html.replace(/<[^>]+>/g, " ") }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        console.error(`[mail] Resend delivery failed (${response.status}): ${detail.slice(0, 300)}`);
      } else {
        return;
      }
    } catch (resendErr) {
      console.error("[mail] Resend delivery error:", (resendErr as Error).message);
    }
  }

  // 3. Fallback log (always printed to server console so links are never lost)
  console.info(`\n[email fallback] to=${to} subject=${subject}\n${text ?? html.replace(/<[^>]+>/g, " ")}\n`);
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

export async function sendPlanRequestAdminEmail({
  adminEmail = "napagunasaisujith@gmail.com",
  userName,
  userEmail,
  phone,
  tier,
  tierName,
  tierPrice,
  pages,
  notes,
}: {
  adminEmail?: string;
  userName: string;
  userEmail: string;
  phone: string;
  tier: string;
  tierName: string;
  tierPrice: number;
  pages: number;
  notes?: string;
}): Promise<void> {
  const cleanPhone = phone.replace(/[^0-9+]/g, "");
  const waUrl = `https://wa.me/${cleanPhone.replace(/^\+/, "")}`;
  const telUrl = `tel:${cleanPhone}`;

  await sendEmail({
    to: adminEmail,
    subject: `🔔 New Plan Request: ${tierName} Plan (${userEmail})`,
    html: layout(
      `New Plan Upgrade Request: ${escapeHtml(tierName)} Plan`,
      `
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin-bottom:20px">
        <p style="margin:0;font-size:16px;font-weight:600;color:#166534">Plan Requested: ${escapeHtml(tierName)} ($${tierPrice}/month - ${pages.toLocaleString()} pages)</p>
      </div>

      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:14px">
        <tr style="border-bottom:1px solid #e5e7eb">
          <td style="padding:10px 0;font-weight:600;color:#4b5563;width:140px">User Name:</td>
          <td style="padding:10px 0;color:#111827;font-weight:500">${escapeHtml(userName || "Not specified")}</td>
        </tr>
        <tr style="border-bottom:1px solid #e5e7eb">
          <td style="padding:10px 0;font-weight:600;color:#4b5563">User Email:</td>
          <td style="padding:10px 0;color:#111827"><a href="mailto:${escapeHtml(userEmail)}" style="color:#2563eb;text-decoration:none">${escapeHtml(userEmail)}</a></td>
        </tr>
        <tr style="border-bottom:1px solid #e5e7eb;background:#fefce8">
          <td style="padding:10px 8px;font-weight:700;color:#854d0e">📱 Mobile Number:</td>
          <td style="padding:10px 8px;font-weight:700;font-size:16px;color:#1e3a8a">
            <a href="${escapeHtml(telUrl)}" style="color:#1d4ed8;text-decoration:none">${escapeHtml(phone)}</a>
            &nbsp;•&nbsp;
            <a href="${escapeHtml(waUrl)}" target="_blank" style="color:#16a34a;text-decoration:none">Chat on WhatsApp ↗</a>
          </td>
        </tr>
        ${
          notes
            ? `<tr style="border-bottom:1px solid #e5e7eb">
          <td style="padding:10px 0;font-weight:600;color:#4b5563;vertical-align:top">Notes / Message:</td>
          <td style="padding:10px 0;color:#374151">${escapeHtml(notes)}</td>
        </tr>`
            : ""
        }
        <tr>
          <td style="padding:10px 0;font-weight:600;color:#4b5563">Requested At:</td>
          <td style="padding:10px 0;color:#6b7280">${new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })} IST</td>
        </tr>
      </table>

      <p style="margin:24px 0 8px;font-size:14px;color:#374151">
        To activate or adjust this user's subscription in HumanDoc, log in to the admin dashboard:
      </p>
      ${button("https://humandoc.vercel.app/admin", "Open HumanDoc Admin Dashboard")}
      `,
    ),
    text: `New Plan Request: ${tierName} Plan ($${tierPrice}/mo)\nUser: ${userName} (${userEmail})\nMobile Number: ${phone}\nNotes: ${notes || "None"}\nManage in Admin: https://humandoc.vercel.app/admin`,
  });
}

export async function sendPlanRequestUserConfirmationEmail({
  to,
  userName,
  tierName,
  tierPrice,
  pages,
}: {
  to: string;
  userName: string;
  tierName: string;
  tierPrice: number;
  pages: number;
}): Promise<void> {
  await sendEmail({
    to,
    subject: `We received your request for the ${tierName} Plan - HumanDoc`,
    html: layout(
      `Plan Request Received: ${escapeHtml(tierName)} Plan`,
      `
      <p>Hi ${escapeHtml(userName || "there")},</p>
      <p>Thank you for choosing HumanDoc! We have received your request for the <strong>${escapeHtml(tierName)} Plan</strong> ($${tierPrice}/month for ${pages.toLocaleString()} pages).</p>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin:16px 0">
        <p style="margin:0;font-size:14px;color:#334155">
          Our team is reviewing your request and will contact you directly on your provided mobile number to assist with payment and activate your plan.
        </p>
      </div>
      <p style="font-size:14px;color:#4b5563">
        In the meantime, you can continue using your current HumanDoc account. If you have any urgent questions, feel free to reply directly to this email.
      </p>
      `,
    ),
    text: `Hi ${userName || "there"},\n\nWe received your request for the ${tierName} Plan ($${tierPrice}/mo).\nOur team will reach out to your mobile number shortly to activate your plan.\n\nThank you,\nHumanDoc Team`,
  });
}
