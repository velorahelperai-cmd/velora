import { describe, expect, it } from 'vitest';
import { validInboxAttachment } from './inbox-attachment-validation';

describe('conversation attachment admission', () => {
  it('accepts canonical, correctly signed supported files', () => {
    expect(validInboxAttachment('صورة.png', 'image/png', 'iVBORw0KGgo=')).toBe(true);
    expect(validInboxAttachment('photo.jpg', 'image/jpeg', '/9j/')).toBe(true);
    expect(validInboxAttachment('invoice.pdf', 'application/pdf', 'JVBERi0=')).toBe(true);
  });
  it('rejects mismatched signatures, unsafe names and noncanonical base64', () => {
    expect(validInboxAttachment('file.pdf', 'application/pdf', 'iVBORw0KGgo=')).toBe(false);
    expect(validInboxAttachment('../file.pdf', 'application/pdf', 'JVBERi0=')).toBe(false);
    expect(validInboxAttachment('file.pdf', 'application/pdf', 'JVBERi0=\n')).toBe(false);
    expect(validInboxAttachment('file.pdf', 'application/pdf', 'JVBERi1=')).toBe(false);
  });
  it('enforces the byte limit before storage', () => {
    const maximum = Buffer.alloc(524288); maximum.write('%PDF-');
    const tooLarge = Buffer.alloc(524289); tooLarge.write('%PDF-');
    expect(validInboxAttachment('file.pdf', 'application/pdf', maximum.toString('base64'))).toBe(true);
    expect(validInboxAttachment('file.pdf', 'application/pdf', tooLarge.toString('base64'))).toBe(false);
  });
});
