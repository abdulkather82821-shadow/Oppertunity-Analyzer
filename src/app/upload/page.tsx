'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, FileText, Upload } from 'lucide-react';
import { AppShell, PageHeader } from '@/components/app-shell';
import { Card, Disclaimer, EmptyState, Spinner } from '@/components/ui';
import { api, ApiClientError, fmtBytes } from '@/lib/client/api';

interface UploadedResume {
  id: string;
  original_name: string;
  size_bytes: number;
  mime_type: string;
  parse_status: string;
  created_at: string;
}

const LIMIT_MB = 10;

export default function UploadPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [resumes, setResumes] = useState<UploadedResume[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    api
      .get<{ resumes: UploadedResume[] }>('/api/resumes')
      .then((data) => setResumes(data.resumes))
      .catch(() => setResumes([]));
  }, []);

  const upload = async (selected: File | null) => {
    if (!selected) return;
    setError(null);
    if (selected.size > LIMIT_MB * 1024 * 1024) {
      setError(`That file is ${fmtBytes(selected.size)}. The limit is ${LIMIT_MB} MB.`);
      return;
    }
    setFile(selected);
    setBusy(true);
    setProgress('Uploading and scanning…');
    try {
      const formData = new FormData();
      formData.append('file', selected);
      setProgress('Extracting text from your document…');
      const result = await api.post<{ resumeId: string; parseStatus: string }>('/api/resumes', formData);
      setProgress('Analysing your resume…');
      router.push(`/analyze?resumeId=${result.resumeId}`);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Upload failed.');
      setBusy(false);
      setProgress(null);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this resume and its extracted text from the server? Your profile stays until you delete it.')) return;
    await api.delete(`/api/resumes/${id}`);
    setResumes(resumes.filter((resume) => resume.id !== id));
  };

  return (
    <AppShell>
      <PageHeader
        title="Upload your resume"
        subtitle="PDF, DOCX or TXT up to 10 MB. The file is scanned, encrypted at rest, and never modified or shared publicly."
      />

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          <Card className="card-pad">
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                void upload(event.dataTransfer.files?.[0] ?? null);
              }}
              className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
                dragging ? 'border-brand-500 bg-brand-50' : 'border-ink-200 bg-ink-50/60'
              }`}
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                <Upload className="h-5 w-5" />
              </span>
              <p className="mt-3 font-medium text-ink-900">Drag your resume here, or choose a file</p>
              <p className="muted mt-1 text-xs">PDF · DOCX · DOC · TXT — maximum {LIMIT_MB} MB</p>
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,.docx,.doc,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                className="hidden"
                onChange={(event) => void upload(event.target.files?.[0] ?? null)}
              />
              <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className="btn-primary mt-4">
                <FileText className="h-4 w-4" /> Choose file
              </button>
              {busy ? (
                <p className="mt-4 flex items-center gap-2 text-sm text-ink-600">
                  <Spinner label={progress ?? 'Working…'} />
                </p>
              ) : null}
            </div>

            {error ? (
              <p className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
              </p>
            ) : null}
          </Card>

          <Card className="card-pad">
            <p className="section-title">Your uploaded resumes</p>
            {resumes.length === 0 ? (
              <p className="muted mt-2">Nothing uploaded yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-ink-100">
                {resumes.map((resume) => (
                  <li key={resume.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink-900">{resume.original_name}</p>
                      <p className="muted text-xs">
                        {fmtBytes(resume.size_bytes)} · {resume.mime_type} · {new Date(resume.created_at).toLocaleDateString('en-IN')}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="badge tone-neutral">{resume.parse_status}</span>
                      <a href={`/api/resumes/${resume.id}/download`} className="btn-secondary btn-sm">
                        Download
                      </a>
                      <button onClick={() => void remove(resume.id)} className="btn-ghost btn-sm text-red-600">
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="card-pad">
            <p className="section-title">What happens next</p>
            <ol className="mt-3 space-y-2.5 text-sm text-ink-700">
              {[
                'Malware scan and format validation',
                'Text extraction (original file untouched)',
                'AI profiling: skills, education, experience, certifications',
                'Confidence scores on every inferred field',
                'Live opportunity and government exam search',
              ].map((step, index) => (
                <li key={step} className="flex gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-700">{index + 1}</span>
                  {step}
                </li>
              ))}
            </ol>
          </Card>

          <Card className="card-pad">
            <p className="section-title">Good resumes contain</p>
            <ul className="mt-3 space-y-2 text-sm text-ink-700">
              {['Degree, field of study and graduation year', 'Skills with the tools you actually used', 'Roles with dates and measurable outcomes', 'Certifications and projects'].map((item) => (
                <li key={item} className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  {item}
                </li>
              ))}
            </ul>
            <p className="muted mt-3 text-xs">
              Missing information is reported as Unknown rather than guessed — add it later from Settings if you prefer.
            </p>
          </Card>

          <Card className="card-pad">
            <p className="section-title">Prefer to look around first?</p>
            <p className="muted mt-1.5 text-sm">You can browse the government exam calendar without a resume.</p>
            <Link href="/exams" className="btn-secondary mt-3 w-full">
              Browse government exams
            </Link>
          </Card>

          <Disclaimer />
        </div>
      </div>

      {resumes.length === 0 && !busy ? <div className="sr-only"><EmptyState title="No resume yet" /></div> : null}
    </AppShell>
  );
}
