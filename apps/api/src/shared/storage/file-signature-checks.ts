/**
 * File-signature ("magic number") checks for every mimetype in ALLOWED_UPLOAD_MIME_TYPES.
 * Shared between LocalDiskStorageEngine and S3StorageEngine so the two providers can never
 * silently drift on what "a real PNG" means — see local-disk-storage.engine.ts's doc comment for
 * why this check exists (the declared multipart mimetype is client-supplied and trivially
 * spoofable; only the actual bytes are trustworthy).
 */
export const SIGNATURE_CHECK_BYTES = 12; // longest signature below (WEBP) needs bytes 0-11

export const FILE_SIGNATURE_CHECKS: Record<string, (head: Buffer) => boolean> =
  {
    'image/jpeg': (head) =>
      head.length >= 3 &&
      head[0] === 0xff &&
      head[1] === 0xd8 &&
      head[2] === 0xff,
    'image/png': (head) =>
      head.length >= 8 &&
      head
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'image/gif': (head) =>
      head.length >= 6 &&
      ['GIF87a', 'GIF89a'].includes(head.subarray(0, 6).toString('ascii')),
    'image/webp': (head) =>
      head.length >= 12 &&
      head.subarray(0, 4).toString('ascii') === 'RIFF' &&
      head.subarray(8, 12).toString('ascii') === 'WEBP',
  };
