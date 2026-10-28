/**
 * Input validation helpers. All user input crosses through here.
 */

export class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ValidationError';
    this.code = 'VALIDATION_ERROR';
    this.status = 400;
    this.field = field;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

export function requireString(value, field, { min = 1, max = 200, label = field } = {}) {
  if (typeof value !== 'string') throw new ValidationError(`${label} is required.`, field);
  const trimmed = value.trim();
  if (trimmed.length < min) throw new ValidationError(`${label} must be at least ${min} characters.`, field);
  if (trimmed.length > max) throw new ValidationError(`${label} must be at most ${max} characters.`, field);
  return trimmed;
}

export function validateEmail(value) {
  const email = requireString(value, 'email', { min: 5, max: 254, label: 'Email' }).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new ValidationError('Enter a valid email address.', 'email');
  return email;
}

export function validateUsername(value) {
  const username = requireString(value, 'username', { min: 3, max: 20, label: 'Username' });
  if (!USERNAME_RE.test(username)) {
    throw new ValidationError('Username may only contain letters, numbers and underscores (3-20).', 'username');
  }
  return username;
}

export function validatePassword(value, field = 'password') {
  const password = requireString(value, field, { min: 10, max: 128, label: 'Password' });
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new ValidationError('Password must include at least one letter and one number.', field);
  }
  return password;
}

export function validateSettings(input) {
  const raw = input && typeof input === 'object' ? input : {};
  const settings = {
    sound: raw.sound === undefined ? true : Boolean(raw.sound),
    autoCashOut: raw.autoCashOut === null || raw.autoCashOut === undefined || raw.autoCashOut === ''
      ? null
      : Number(raw.autoCashOut),
  };
  if (settings.autoCashOut !== null) {
    if (!Number.isFinite(settings.autoCashOut) || settings.autoCashOut < 1.01 || settings.autoCashOut > 500) {
      throw new ValidationError('Auto cash-out must be between 1.01x and 500x.', 'autoCashOut');
    }
    settings.autoCashOut = Math.round(settings.autoCashOut * 100) / 100;
  }
  return settings;
}
