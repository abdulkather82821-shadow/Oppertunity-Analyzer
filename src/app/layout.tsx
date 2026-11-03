import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Opportunity Analyzer AI — Upload Your Resume. Discover Your Next Opportunity.',
  description:
    'Upload your resume, let AI analyse your profile, and discover matched jobs and government examinations with real eligibility checks, deadline tracking and source verification.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-ink-50 text-ink-900 antialiased">{children}</body>
    </html>
  );
}
