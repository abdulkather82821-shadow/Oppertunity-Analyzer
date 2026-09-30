import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  UploadError,
  decryptAtRest,
  encryptAtRest,
  extractResumeText,
  reconstructPdfLines,
  sniffType,
  validateUpload,
  type PdfTextItem,
} from '@/lib/parsing/extract';
import { parseResume } from '@/lib/analysis/resume-parser';

/**
 * Turning an uploaded file into text.
 *
 * Real resume files are the most hostile input the app takes. These tests use real PDF, DOCX
 * and TXT files (tests/fixtures — also handy for trying the upload by hand), and pin the two
 * rules that matter: a genuine resume must come out with its line structure intact, and a bad
 * file must be refused with a clear, typed reason instead of crashing.
 */

const fixture = (name: string) => new Uint8Array(readFileSync(path.join(__dirname, 'fixtures', name)));
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function textOf(name: string, mime: string) {
  const bytes = fixture(name);
  const extension = validateUpload(bytes, name, mime);
  return extractResumeText(bytes, extension, mime);
}

describe('real files', () => {
  it('reads a PDF with its lines intact, so section headings are recognisable', async () => {
    const { text } = await textOf('sample-resume.pdf', 'application/pdf');
    // Merging fragments without positions gave ONE line; headings must be on their own lines.
    expect(text.split('\n').length).toBeGreaterThan(8);
    for (const heading of ['EDUCATION', 'SKILLS', 'EXPERIENCE']) expect(text.split('\n')).toContain(heading);
  });

  it('parses a PDF resume to the same result as the same resume as DOCX and TXT', async () => {
    const [pdf, docx, txt] = await Promise.all([
      textOf('sample-resume.pdf', 'application/pdf'),
      textOf('sample-resume.docx', DOCX_MIME),
      textOf('sample-resume.txt', 'text/plain'),
    ]);
    const summary = (text: string) => {
      const parsed = parseResume(text);
      return {
        name: parsed.personal.name,
        education: parsed.education[0]?.degree,
        institution: parsed.education[0]?.institution,
        year: parsed.education[0]?.graduationYear,
        skills: parsed.skills.length > 4,
        experience: parsed.experience[0]?.jobTitle,
      };
    };
    expect(summary(pdf.text)).toEqual(summary(docx.text));
    expect(summary(pdf.text)).toMatchObject({ name: 'PRIYA RAMESH', education: 'B.Com', institution: 'University of Madras', year: 2025, skills: true });
    expect(summary(txt.text).name).toBe('PRIYA RAMESH');
  });

  it('reads a DOCX as lines, not double-spaced paragraphs', async () => {
    const { text } = await textOf('sample-resume.docx', DOCX_MIME);
    // mammoth separates paragraphs with a blank line; a resume paragraph is a line.
    expect(text).toContain('EDUCATION\nBachelor of Commerce');
    expect(text).not.toMatch(/\n\n\n/);
  });

  it('keeps the institution and graduation year of a DOCX education entry', async () => {
    const { text } = await textOf('sample-resume.docx', DOCX_MIME);
    const education = parseResume(text).education[0];
    expect(education).toMatchObject({ degree: 'B.Com', institution: 'University of Madras', graduationYear: 2025, score: '78' });
  });

  it('keeps an education entry whose details sit after blank lines', () => {
    const parsed = parseResume('RAVI K\nEDUCATION\nB.Com, Accounting\n\nUniversity of Madras\n\n2022\n');
    expect(parsed.education[0]).toMatchObject({ degree: 'B.Com', institution: 'University of Madras', graduationYear: 2022 });
  });

  it('never changes the original bytes it was given', async () => {
    const bytes = fixture('sample-resume.pdf');
    const before = Buffer.from(bytes).toString('hex');
    await extractResumeText(bytes, 'pdf', 'application/pdf');
    expect(Buffer.from(bytes).toString('hex')).toBe(before);
  });

  it('fingerprints the file so a duplicate upload is recognisable', async () => {
    const a = await textOf('sample-resume.pdf', 'application/pdf');
    const b = await textOf('sample-resume.pdf', 'application/pdf');
    expect(a.sha256).toBe(b.sha256);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('refusing bad files', () => {
  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (error) {
      return error instanceof UploadError ? error.code : `not-an-UploadError: ${String(error)}`;
    }
    return 'accepted';
  };
  const asyncCode = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (error) {
      return error instanceof UploadError ? error.code : `not-an-UploadError: ${String(error)}`;
    }
    return 'accepted';
  };

  it('rejects an image renamed to .pdf', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(64).fill(0)]);
    expect(code(() => validateUpload(png, 'resume.pdf', 'application/pdf'))).toBe('unsupported_type');
  });

  it('rejects a zip that is not a Word document', () => {
    const notWord = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...Buffer.from('xl/workbook.xml PK spreadsheet content here')]);
    expect(sniffType(notWord)).toBeNull();
    expect(code(() => validateUpload(notWord, 'resume.docx', DOCX_MIME))).toBe('unsupported_type');
  });

  it('accepts a zip that does hold the Word document part', () => {
    const wordish = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...Buffer.from('word/document.xml')]);
    expect(sniffType(wordish)?.extension).toBe('docx');
  });

  it('reports a Word file it cannot open as unreadable, not as a server error', async () => {
    const corrupt = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...Buffer.from('word/document.xml'), ...new Array(200).fill(7)]);
    expect(await asyncCode(() => extractResumeText(corrupt, 'docx', DOCX_MIME))).toBe('unreadable_file');
  });

  it('reports a PDF it cannot open as unreadable', async () => {
    const corrupt = new Uint8Array([...Buffer.from('%PDF-1.4\n'), ...Buffer.from('this is not a real pdf body at all'.repeat(6))]);
    expect(await asyncCode(() => extractResumeText(corrupt, 'pdf', 'application/pdf'))).toBe('unreadable_file');
  });

  it('says so plainly when a file contains no text', async () => {
    const blank = new Uint8Array(Buffer.from('   \n\n   \t  \n'));
    expect(code(() => validateUpload(blank, 'empty.txt', 'text/plain'))).toBe('accepted');
    expect(await asyncCode(() => extractResumeText(blank, 'txt', 'text/plain'))).toBe('no_text');
  });

  it('refuses a near-empty resume rather than profiling nothing', async () => {
    const tiny = new Uint8Array(Buffer.from('Hello there.'));
    expect(await asyncCode(() => extractResumeText(tiny, 'txt', 'text/plain'))).toBe('empty_resume');
  });

  it('refuses an empty upload and an oversized one', () => {
    expect(code(() => validateUpload(new Uint8Array(0), 'a.pdf'))).toBe('empty_file');
    vi.stubEnv('MAX_UPLOAD_BYTES', '10'); // read at import time, so use a buffer above the real default instead
    vi.unstubAllEnvs();
    const huge = new Uint8Array(11 * 1024 * 1024);
    huge.set([0x25, 0x50, 0x44, 0x46]);
    expect(code(() => validateUpload(huge, 'big.pdf', 'application/pdf'))).toBe('file_too_large');
  });

  it('refuses binary content posing as text', () => {
    const binary = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x00, 0x01]);
    expect(code(() => validateUpload(binary, 'resume.txt', 'text/plain'))).toBe('unsupported_type');
  });
});

describe('PDF line reconstruction', () => {
  const item = (str: string, x: number, y: number, width = str.length * 5, height = 10): PdfTextItem => ({ str, transform: [1, 0, 0, height, x, y], width, height });

  it('orders fragments top-to-bottom and left-to-right, whatever order the file lists them in', () => {
    const text = reconstructPdfLines([item('World', 60, 700), item('Second line', 10, 686), item('Hello', 10, 700)]);
    expect(text).toBe('Hello World\nSecond line');
  });

  it('puts a space between fragments only where there is a visible gap', () => {
    // "Acc" + "ounts" touch (one word split by kerning); "Payable" is a separate word.
    const text = reconstructPdfLines([item('Acc', 10, 700, 15), item('ounts', 25, 700, 25), item('Payable', 60, 700, 35)]);
    expect(text).toBe('Accounts Payable');
  });

  it('leaves a blank line at a large vertical gap, which is how sections stay separate', () => {
    const text = reconstructPdfLines([item('NAME', 10, 800), item('EDUCATION', 10, 760), item('B.Com', 10, 746)]);
    expect(text.split('\n')).toEqual(['NAME', '', 'EDUCATION', 'B.Com']);
  });

  it('splits side-by-side columns instead of fusing their headings into one line', () => {
    const text = reconstructPdfLines([item('SKILLS', 10, 700, 30), item('EDUCATION', 300, 700, 45), item('Excel', 10, 686, 25), item('B.Com', 300, 686, 25)]);
    const lines = text.split('\n');
    expect(lines).toContain('SKILLS');
    expect(lines).toContain('EDUCATION');
    expect(lines).not.toContain('SKILLS EDUCATION');
  });

  it('groups fragments whose baselines differ by a pixel or two onto one line', () => {
    expect(reconstructPdfLines([item('Senior', 10, 700.4), item('Accountant', 50, 699.2)])).toBe('Senior Accountant');
  });

  it('ignores items without text or position and returns "" for nothing', () => {
    expect(reconstructPdfLines([])).toBe('');
    expect(reconstructPdfLines([{ str: '' }, { str: 'x' }, { transform: [1, 0, 0, 1, 0, 0] }])).toBe('');
  });
});

describe('encryption at rest', () => {
  afterEach(() => vi.unstubAllEnvs());
  const payload = new Uint8Array(Buffer.from('PRIYA RAMESH — private resume bytes'));

  it('round-trips, and the stored bytes do not contain the plaintext', () => {
    vi.stubEnv('ENCRYPTION_KEY', 'a-long-random-secret-for-tests-0123456789');
    const sealed = encryptAtRest(payload);
    expect(sealed.encrypted).toBe(true);
    expect(Buffer.from(sealed.data).includes('PRIYA')).toBe(false);
    expect(Buffer.from(decryptAtRest(sealed.data, true)).toString('utf8')).toBe('PRIYA RAMESH — private resume bytes');
  });

  it('uses a fresh IV each time, so identical resumes do not produce identical files', () => {
    vi.stubEnv('ENCRYPTION_KEY', 'a-long-random-secret-for-tests-0123456789');
    expect(Buffer.from(encryptAtRest(payload).data).equals(Buffer.from(encryptAtRest(payload).data))).toBe(false);
  });

  it('detects tampering instead of returning altered content', () => {
    vi.stubEnv('ENCRYPTION_KEY', 'a-long-random-secret-for-tests-0123456789');
    const sealed = Buffer.from(encryptAtRest(payload).data);
    sealed[sealed.length - 1] ^= 0xff;
    expect(() => decryptAtRest(sealed, true)).toThrow();
  });

  it('will not decrypt with the wrong key', () => {
    vi.stubEnv('ENCRYPTION_KEY', 'the-right-key-the-right-key-the-right-key');
    const sealed = encryptAtRest(payload).data;
    vi.stubEnv('ENCRYPTION_KEY', 'a-different-key-a-different-key-000000');
    expect(() => decryptAtRest(sealed, true)).toThrow();
  });

  it('says plainly that nothing was encrypted when no key is configured', () => {
    vi.stubEnv('ENCRYPTION_KEY', '');
    const result = encryptAtRest(payload);
    expect(result.encrypted).toBe(false);
    expect(Buffer.from(result.data).toString('utf8')).toContain('PRIYA');
  });

  it('fails loudly if an encrypted file is read after the key has been removed', () => {
    vi.stubEnv('ENCRYPTION_KEY', 'a-long-random-secret-for-tests-0123456789');
    const sealed = encryptAtRest(payload).data;
    vi.stubEnv('ENCRYPTION_KEY', '');
    expect(() => decryptAtRest(sealed, true)).toThrow(/ENCRYPTION_KEY/);
  });
});
