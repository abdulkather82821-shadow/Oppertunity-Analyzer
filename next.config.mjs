/** @type {import('next').NextConfig} */
/**
 * Who may show this app inside a frame. The default, 'none', forbids everyone (clickjacking
 * protection). Set FRAME_ANCESTORS to "'self'", to specific origins, or to "*" for a preview
 * environment. NOTE: Next.js compiles header rules into the build, so this is read at BUILD time.
 */
const rawAncestors = (process.env.FRAME_ANCESTORS ?? 'none').trim() || 'none';
// dotenv strips quotes, so `FRAME_ANCESTORS='none'` arrives as the bare word `none`, which is not
// a valid CSP keyword and would silently protect nothing. Re-quote the keywords, and refuse any
// value containing characters that could break out of the header (falling back to the strict default).
const safeAncestors = /^[A-Za-z0-9:/.*'\-\s]+$/.test(rawAncestors) ? rawAncestors : 'none';
const frameAncestors = safeAncestors
  .split(/\s+/)
  .map((token) => (token === 'none' || token === 'self' ? `'${token}'` : token))
  .join(' ');
const framingHeaders = [{ key: 'Content-Security-Policy', value: `frame-ancestors ${frameAncestors}` }];
// X-Frame-Options can only express "nobody" or "same origin"; anything else is CSP-only.
if (frameAncestors === "'none'") framingHeaders.push({ key: 'X-Frame-Options', value: 'DENY' });
else if (frameAncestors === "'self'") framingHeaders.push({ key: 'X-Frame-Options', value: 'SAMEORIGIN' });

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // `unpdf`/`pdfjs` and `mammoth` need to stay external in the Node runtime.
  // (Next 15 moved this out of `experimental`.)
  serverExternalPackages: ['mammoth', 'unpdf', 'pg', 'nodemailer'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          ...framingHeaders,
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
        ],
      },
    ];
  },
};
export default nextConfig;
