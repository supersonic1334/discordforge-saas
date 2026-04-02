'use strict';

const config = require('../config');
const logger = require('../utils/logger').child('MailService');

let transporterPromise = null;

function parseBooleanish(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function inferSmtpHost(emailOrUser) {
  const source = String(emailOrUser || '').trim().toLowerCase();
  const domain = source.includes('@') ? source.split('@')[1] : source;

  switch (domain) {
    case 'gmail.com':
    case 'googlemail.com':
      return 'smtp.gmail.com';
    case 'outlook.com':
    case 'hotmail.com':
    case 'live.com':
    case 'msn.com':
      return 'smtp-mail.outlook.com';
    case 'yahoo.com':
    case 'yahoo.fr':
      return 'smtp.mail.yahoo.com';
    case 'icloud.com':
    case 'me.com':
    case 'mac.com':
      return 'smtp.mail.me.com';
    case 'orange.fr':
    case 'orange.com':
    case 'wanadoo.fr':
      return 'smtp.orange.fr';
    case 'free.fr':
      return 'smtp.free.fr';
    default:
      return '';
  }
}

function getRuntimeMailConfig() {
  const env = process.env;
  const fromEmail = firstNonEmpty(
    config.SMTP_FROM_EMAIL,
    env.MAIL_FROM_EMAIL,
    env.EMAIL_FROM,
    env.MAIL_FROM,
    env.SMTP_FROM,
    env.FROM_EMAIL
  );
  const user = firstNonEmpty(
    config.SMTP_USER,
    env.MAIL_USER,
    env.EMAIL_USER,
    env.SMTP_USERNAME,
    env.MAIL_USERNAME
  );
  const host = firstNonEmpty(
    config.SMTP_HOST,
    env.MAIL_HOST,
    env.EMAIL_HOST,
    inferSmtpHost(user),
    inferSmtpHost(fromEmail)
  );
  const port = Number(firstNonEmpty(
    config.SMTP_PORT,
    env.MAIL_PORT,
    env.EMAIL_PORT,
    host ? '587' : ''
  ) || 0);
  const secure = parseBooleanish(
    firstNonEmpty(config.SMTP_SECURE, env.MAIL_SECURE, env.EMAIL_SECURE, port === 465 ? 'true' : ''),
    port === 465
  );
  const pass = firstNonEmpty(
    config.SMTP_PASS,
    env.MAIL_PASS,
    env.EMAIL_PASS,
    env.SMTP_PASSWORD,
    env.MAIL_PASSWORD
  );
  const fromName = firstNonEmpty(
    config.SMTP_FROM_NAME,
    env.MAIL_FROM_NAME,
    env.EMAIL_FROM_NAME,
    'DiscordForger Security'
  );
  const connectionUrl = firstNonEmpty(
    env.SMTP_URL,
    env.MAIL_URL,
    env.EMAIL_URL
  );

  return {
    host,
    port,
    secure,
    user,
    pass,
    fromEmail,
    fromName,
    connectionUrl,
  };
}

function isMailConfigured() {
  const runtime = getRuntimeMailConfig();
  if (runtime.connectionUrl) return true;
  return Boolean(runtime.host && runtime.port && runtime.fromEmail);
}

async function getTransporter() {
  const runtime = getRuntimeMailConfig();
  if (!(runtime.connectionUrl || (runtime.host && runtime.port && runtime.fromEmail))) {
    throw Object.assign(new Error('SMTP non configure'), { status: 503 });
  }

  if (!transporterPromise) {
    transporterPromise = (async () => {
      const nodemailer = require('nodemailer');
      const transporter = runtime.connectionUrl
        ? nodemailer.createTransport(runtime.connectionUrl)
        : nodemailer.createTransport({
            host: runtime.host,
            port: runtime.port,
            secure: !!runtime.secure,
            auth: runtime.user
              ? {
                  user: runtime.user,
                  pass: runtime.pass || '',
                }
              : undefined,
          });

      return transporter;
    })().catch((error) => {
      transporterPromise = null;
      throw error;
    });
  }

  return transporterPromise;
}

async function sendEmail({ to, subject, html, text }) {
  const transporter = await getTransporter();
  const runtime = getRuntimeMailConfig();

  try {
    await transporter.sendMail({
      from: `"${runtime.fromName}" <${runtime.fromEmail}>`,
      to,
      subject,
      text,
      html,
    });
  } catch (error) {
    logger.error(`Email send failed: ${error.message}`, { to, subject });
    throw Object.assign(new Error('Envoi e-mail impossible'), { status: 503 });
  }
}

module.exports = {
  isMailConfigured,
  sendEmail,
};
