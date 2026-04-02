'use strict';

const config = require('../config');
const logger = require('../utils/logger').child('MailService');

let transporterPromise = null;

function isMailConfigured() {
  return Boolean(
    config.SMTP_HOST
    && config.SMTP_PORT
    && config.SMTP_FROM_EMAIL
  );
}

async function getTransporter() {
  if (!isMailConfigured()) {
    throw Object.assign(new Error('SMTP non configure'), { status: 503 });
  }

  if (!transporterPromise) {
    transporterPromise = (async () => {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        secure: !!config.SMTP_SECURE,
        auth: config.SMTP_USER
          ? {
              user: config.SMTP_USER,
              pass: config.SMTP_PASS || '',
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

  try {
    await transporter.sendMail({
      from: `"${config.SMTP_FROM_NAME}" <${config.SMTP_FROM_EMAIL}>`,
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
