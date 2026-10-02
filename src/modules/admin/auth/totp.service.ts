import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_WINDOW = 1;
const RECOVERY_CODE_COUNT = 8;
// Crockford-style alphabet without ambiguous 0/O/1/I/L.
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * TOTP (RFC 6238, SHA-1, 30s, 6 digits) + AES-256-GCM secret storage +
 * single-use recovery codes. Dependency-free on node:crypto.
 */
@Injectable()
export class TotpService {
  private readonly logger = new Logger(TotpService.name);
  private ephemeralKeyWarningLogged = false;
  private ephemeralKey: Buffer | null = null;

  constructor(private readonly config: ConfigService) {}

  generateSecret(bytes = 20): { raw: Buffer; base32: string } {
    const raw = randomBytes(bytes);
    return { raw, base32: base32Encode(raw) };
  }

  otpauthUri(secretBase32: string, account: string): string {
    const issuer = 'HiRotoli Admin';
    const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
    return (
      `otpauth://totp/${label}?secret=${secretBase32}` +
      `&issuer=${encodeURIComponent(issuer)}&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`
    );
  }

  /**
   * Verifies a code. Requires step > lastUsedStep (replay protection).
   * Returns the accepted step for storage, or null.
   */
  verify(
    secret: Buffer,
    code: string,
    options?: { now?: number; lastUsedStep?: bigint | number | null },
  ): { ok: true; step: number } | { ok: false; step: null } {
    const digits = code.replace(/[\s-]/g, '');
    if (!/^\d{6}$/.test(digits)) {
      return { ok: false, step: null };
    }
    const now = options?.now ?? Date.now();
    const currentStep = Math.floor(now / 1000 / TOTP_STEP_SECONDS);
    const lastUsed =
      options?.lastUsedStep === null || options?.lastUsedStep === undefined
        ? -1
        : Number(options.lastUsedStep);

    for (let step = currentStep - TOTP_WINDOW; step <= currentStep + TOTP_WINDOW; step += 1) {
      if (step <= lastUsed) {
        continue;
      }
      if (hotp(secret, step) === digits) {
        return { ok: true, step };
      }
    }
    return { ok: false, step: null };
  }

  generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
    const codes: string[] = [];
    for (let i = 0; i < count; i += 1) {
      // 10 chars of ~5 bits each from 10 random bytes, shown as 5-5 groups.
      const bytes = randomBytes(10);
      let code = '';
      for (const byte of bytes) {
        code += RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length];
      }
      codes.push(`${code.slice(0, 5)}-${code.slice(5, 10)}`);
    }
    return codes;
  }

  normalizeRecoveryCode(code: string): string {
    return code.trim().toUpperCase().replace(/[\s]/g, '');
  }

  encryptSecret(secret: Buffer): string {
    const key = this.encryptionKey();
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${nonce.toString('base64')}.${Buffer.concat([ciphertext, tag]).toString('base64')}`;
  }

  decryptSecret(payload: string): Buffer {
    const [version, nonceB64, dataB64] = payload.split('.');
    if (version !== 'v1' || !nonceB64 || !dataB64) {
      throw new Error('INVALID_SECRET_ENVELOPE');
    }
    const key = this.encryptionKey();
    const nonce = Buffer.from(nonceB64, 'base64');
    const combined = Buffer.from(dataB64, 'base64');
    const tag = combined.subarray(combined.length - 16);
    const ciphertext = combined.subarray(0, combined.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  private encryptionKey(): Buffer {
    const configured = this.config.get<string>('admin.mfaEncryptionKey');
    if (configured && /^[0-9a-fA-F]{64}$/.test(configured.trim())) {
      return Buffer.from(configured.trim(), 'hex');
    }
    const nodeEnv = this.config.get<string>('app.nodeEnv') ?? 'development';
    if (nodeEnv === 'production') {
      throw new Error('ADMIN_MFA_ENCRYPTION_KEY_REQUIRED');
    }
    if (!this.ephemeralKey) {
      this.ephemeralKey = randomBytes(32);
    }
    if (!this.ephemeralKeyWarningLogged) {
      this.ephemeralKeyWarningLogged = true;
      this.logger.warn(
        'ADMIN_MFA_ENCRYPTION_KEY is missing; using an ephemeral key. ' +
          'MFA secrets will be unreadable after restart. Set a 64-hex-char key.',
      );
    }
    return this.ephemeralKey;
  }
}

export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.trim().replace(/=+$/, '').toUpperCase();
  if (!/^[A-Z2-7]*$/.test(clean)) {
    throw new Error('INVALID_BASE32');
  }
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function hotp(secret: Buffer, counter: number): string {
  const counterBuffer = Buffer.alloc(8);
  // Counter fits 32 bits for all practical time-steps; high word stays zero.
  counterBuffer.writeUInt32BE(0, 0);
  counterBuffer.writeUInt32BE(counter, 4);
  const hmac = createHmac('sha1', secret).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (binary % 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, '0');
}
