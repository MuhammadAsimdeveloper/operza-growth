/**
 * Phase 8.1 — Upload Quarantine & Extensible Malware Scanning Boundary
 * Validates magic-byte signatures, MIME type, and size, stages untrusted uploads
 * in private quarantine, and requires a verified malware scanner (e.g. ClamAV)
 * before releasing files. Fails closed when scanner is unavailable in strict mode.
 */

import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const ALLOWED_SIGNATURES = Object.freeze({
  'application/pdf': (buf) => buf.subarray(0, 5).toString('ascii') === '%PDF-',
  'image/png': (buf) => buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47,
  'image/jpeg': (buf) => buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  'text/plain': (buf) => !buf.includes(0x00)
});

export function validateFileSignature(buffer, mimeType) {
  const checker = ALLOWED_SIGNATURES[String(mimeType || '').toLowerCase()];
  if (!checker) {
    return { valid: false, code: 'UNSUPPORTED_MIME_TYPE', message: `Unsupported MIME type: ${mimeType}` };
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { valid: false, code: 'EMPTY_UPLOAD', message: 'Upload buffer cannot be empty' };
  }
  if (!checker(buffer)) {
    return { valid: false, code: 'UPLOAD_SIGNATURE_MISMATCH', message: `File bytes do not match ${mimeType}` };
  }
  return { valid: true };
}

export function createClamAvScanner({ binaryPath = 'clamscan' } = {}) {
  return {
    name: 'clamav',
    async scanBuffer(buffer) {
      const tmpFile = path.join(os.tmpdir(), `operza-scan-${randomUUID()}`);
      await fs.writeFile(tmpFile, buffer);
      try {
        return await new Promise((resolve) => {
          execFile(binaryPath, ['--no-summary', tmpFile], (err, stdout, stderr) => {
            if (!err) {
              resolve({ status: 'clean', engine: 'clamav' });
            } else if (err.code === 1) {
              resolve({ status: 'infected', engine: 'clamav', details: String(stdout || stderr).trim() });
            } else {
              resolve({ status: 'unavailable', engine: 'clamav', code: 'MALWARE_SCANNER_UNAVAILABLE', error: err.message });
            }
          });
        });
      } finally {
        await fs.unlink(tmpFile).catch(() => {});
      }
    }
  };
}

export function createUploadQuarantineService({
  scanner = null,
  failClosedOnUnavailable = true,
  maxBytes = 5 * 1024 * 1024,
  auditSink = null
} = {}) {
  const quarantineStore = new Map();

  async function ingestAndScan({
    agencyId,
    locationId,
    actorId = 'system',
    filename = 'upload.bin',
    mimeType,
    buffer
  } = {}) {
    if (!agencyId || !locationId) {
      throw Object.assign(new TypeError('Tenant context required for upload'), { code: 'TENANT_CONTEXT_REQUIRED' });
    }
    if (!Buffer.isBuffer(buffer) || buffer.length > maxBytes) {
      return { ok: false, status: 'rejected', code: 'UPLOAD_TOO_LARGE', message: `Upload exceeds ${maxBytes} bytes` };
    }

    const sigCheck = validateFileSignature(buffer, mimeType);
    if (!sigCheck.valid) {
      auditSink?.({ event: 'upload.rejected_signature', agencyId, locationId, actorId, code: sigCheck.code });
      return { ok: false, status: 'rejected', code: sigCheck.code, message: sigCheck.message };
    }

    const uploadId = randomUUID();
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const entry = {
      id: uploadId,
      agencyId,
      locationId,
      filename: path.basename(String(filename)),
      mimeType,
      sizeBytes: buffer.length,
      sha256,
      status: 'quarantined',
      publiclyAccessible: false,
      scanEngine: scanner?.name || 'none',
      createdAt: new Date().toISOString()
    };
    quarantineStore.set(uploadId, entry);

    if (!scanner || typeof scanner.scanBuffer !== 'function') {
      if (failClosedOnUnavailable) {
        entry.status = 'rejected_scanner_unavailable';
        auditSink?.({ event: 'upload.scanner_unavailable', agencyId, locationId, uploadId });
        return {
          ok: false,
          uploadId,
          status: entry.status,
          code: 'MALWARE_SCANNER_UNAVAILABLE',
          message: 'Malware scanner unavailable; quarantined file cannot be released'
        };
      }
      return { ok: true, upload: entry };
    }

    const scanResult = await scanner.scanBuffer(buffer);
    if (scanResult.status === 'infected') {
      entry.status = 'infected_quarantined';
      auditSink?.({ event: 'upload.malware_detected', agencyId, locationId, uploadId, engine: scanner.name });
      return {
        ok: false,
        uploadId,
        status: entry.status,
        code: 'MALWARE_DETECTED',
        message: 'Upload quarantined due to malware detection'
      };
    }

    if (scanResult.status !== 'clean') {
      entry.status = 'rejected_scanner_unavailable';
      auditSink?.({ event: 'upload.scanner_error', agencyId, locationId, uploadId });
      return {
        ok: false,
        uploadId,
        status: entry.status,
        code: 'MALWARE_SCANNER_UNAVAILABLE',
        message: scanResult.error || 'Scanner unavailable'
      };
    }

    entry.status = 'clean_released';
    entry.publiclyAccessible = true;
    auditSink?.({ event: 'upload.scan_clean', agencyId, locationId, uploadId, sha256 });
    return { ok: true, upload: { ...entry } };
  }

  function getUploadForTenant({ uploadId, agencyId, locationId }) {
    const entry = quarantineStore.get(uploadId);
    if (!entry || entry.agencyId !== agencyId || entry.locationId !== locationId) return null;
    return entry.status === 'clean_released' ? { ...entry } : null;
  }

  return { ingestAndScan, getUploadForTenant };
}
