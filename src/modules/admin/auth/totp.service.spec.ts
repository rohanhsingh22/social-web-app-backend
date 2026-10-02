import { TotpService, base32Decode, base32Encode } from './totp.service';
import { ConfigService } from '@nestjs/config';

// RFC 6238 Appendix B vectors, SHA-1, secret ASCII "12345678901234567890".
// 6-digit codes are binary mod 10^6, i.e. the last 6 digits of the RFC
// 8-digit values (07081804, 14050471, 89024720, 69279037, 65353130).
const RFC_SECRET_B32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const VECTORS: Array<[number, string]> = [
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
  [20000000000, '353130'],
];

describe('TotpService', () => {
  const secret = Buffer.from('12345678901234567890', 'ascii');
  const config = {
    get: (key: string) => {
      if (key === 'admin.mfaEncryptionKey') {
        return '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      }
      return undefined;
    },
  } as unknown as ConfigService;
  const service = new TotpService(config);

  it('decodes the RFC test secret', () => {
    expect(base32Decode(RFC_SECRET_B32).toString('ascii')).toBe(
      '12345678901234567890',
    );
    expect(base32Encode(secret)).toBe(RFC_SECRET_B32);
  });

  it.each(VECTORS)('accepts the RFC vector at T=%i', (time, code) => {
    expect(
      service.verify(secret, code, { now: time * 1000, lastUsedStep: null }),
    ).toEqual({ ok: true, step: Math.floor(time / 30) });
  });

  it('rejects wrong codes and malformed input', () => {
    expect(
      service.verify(secret, '000000', { now: 59_000, lastUsedStep: null }).ok,
    ).toBe(false);
    expect(
      service.verify(secret, 'abcdef', { now: 59_000, lastUsedStep: null }).ok,
    ).toBe(false);
  });

  it('rejects replayed and older steps', () => {
    const first = service.verify(secret, '287082', {
      now: 59_000,
      lastUsedStep: null,
    });
    expect(first).toEqual({ ok: true, step: 1 });

    // Same code again: steps 0..2 checked, step 1 skipped as used, others differ.
    expect(
      service.verify(secret, '287082', {
        now: 59_000,
        lastUsedStep: first.ok ? first.step : -1,
      }).ok,
    ).toBe(false);
  });

  it('accepts adjacent steps within the window', () => {
    // Counter-2 code presented one step early (clock skew tolerance).
    expect(
      service.verify(secret, '359152', { now: 59_000, lastUsedStep: null }),
    ).toEqual({ ok: true, step: 2 });
  });

  it('encrypts secrets with round-trip fidelity', () => {
    const encrypted = service.encryptSecret(secret);
    expect(encrypted.startsWith('v1.')).toBe(true);
    expect(service.decryptSecret(encrypted)).toEqual(secret);
  });

  it('generates unique recovery codes in display format', () => {
    const codes = service.generateRecoveryCodes();
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    }
    expect(service.normalizeRecoveryCode('  abcd1-efgh2 ')).toBe('ABCD1-EFGH2');
  });

  it('fails closed in production without an encryption key', () => {
    const prodConfig = {
      get: (key: string) =>
        key === 'app.nodeEnv' ? 'production' : undefined,
    } as unknown as ConfigService;
    const prod = new TotpService(prodConfig);
    expect(() => prod.encryptSecret(secret)).toThrow(
      'ADMIN_MFA_ENCRYPTION_KEY_REQUIRED',
    );
  });
});
