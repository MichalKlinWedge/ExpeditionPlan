import nodemailer from "nodemailer";

/**
 * Wysyłka e-maili z serwisu przez SMTP: te same dane co „Custom SMTP” w Supabase Auth (Resend i inni).
 * Supabase nie udostępnia swojego SMTP do własnych wiadomości, więc dane są osobno, w zmiennych serwera:
 * `SMTP_HOST`, `SMTP_PORT` (domyślnie 465), `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`. Bez nich funkcja
 * jest wyłączona, a zaproszenia zostają do skopiowania.
 */

export const mailConfigured = () => Boolean(process.env.SMTP_HOST && process.env.MAIL_FROM);

export async function sendMail(message: { to: string; subject: string; text: string; replyTo?: string }) {
  const port = Number(process.env.SMTP_PORT || 465);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    ...(process.env.SMTP_USER ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } } : {}),
  });
  await transport.sendMail({ from: process.env.MAIL_FROM, ...message });
}
