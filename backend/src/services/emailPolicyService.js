'use strict';

const dns = require('node:dns').promises;
const config = require('../config');

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function getEmailDomain(email) {
  const normalizedEmail = normalizeEmail(email);
  const [, domain = ''] = normalizedEmail.split('@');
  return domain.trim().toLowerCase();
}

function parseDomainSet(value) {
  return new Set(
    String(value || '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  );
}

const ALLOWED_EMAIL_DOMAINS = parseDomainSet(config.AUTH_ALLOWED_EMAIL_DOMAINS);
const BLOCKED_EMAIL_DOMAINS = parseDomainSet(config.AUTH_BLOCKED_EMAIL_DOMAINS);

async function domainHasMailExchange(domain) {
  if (!domain) return false;

  try {
    const mxRecords = await dns.resolveMx(domain);
    if (Array.isArray(mxRecords) && mxRecords.length > 0) {
      return true;
    }
  } catch (error) {
    if (!['ENODATA', 'ENOTFOUND', 'ESERVFAIL', 'ETIMEOUT', 'EAI_AGAIN'].includes(error?.code)) {
      throw error;
    }
  }

  try {
    const ipv4 = await dns.resolve4(domain);
    if (Array.isArray(ipv4) && ipv4.length > 0) return true;
  } catch {}

  try {
    const ipv6 = await dns.resolve6(domain);
    if (Array.isArray(ipv6) && ipv6.length > 0) return true;
  } catch {}

  return false;
}

async function assertAllowedRegistrationEmail(email, options = {}) {
  const normalizedEmail = normalizeEmail(email);
  const domain = getEmailDomain(normalizedEmail);
  const allowKnownBypass = !!options.allowKnownBypass;

  if (!normalizedEmail || !domain) {
    throw Object.assign(new Error('Adresse e-mail invalide'), { status: 400 });
  }

  if (BLOCKED_EMAIL_DOMAINS.has(domain)) {
    throw Object.assign(new Error('Les adresses e-mail temporaires sont refusees'), { status: 400 });
  }

  if (config.AUTH_REQUIRE_ALLOWED_EMAIL_DOMAIN && !allowKnownBypass && !ALLOWED_EMAIL_DOMAINS.has(domain)) {
    throw Object.assign(new Error('Utilise une adresse e-mail d un fournisseur reconnu'), { status: 400 });
  }

  const hasMailExchange = await domainHasMailExchange(domain);
  if (!hasMailExchange) {
    throw Object.assign(new Error('Ce domaine e-mail ne recoit pas de messages'), { status: 400 });
  }

  return {
    email: normalizedEmail,
    domain,
  };
}

module.exports = {
  normalizeEmail,
  getEmailDomain,
  assertAllowedRegistrationEmail,
  ALLOWED_EMAIL_DOMAINS,
  BLOCKED_EMAIL_DOMAINS,
};
