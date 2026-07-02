/** @type {import('next').NextConfig} */

const securityHeaders = [
  // Block clickjacking (embedding in iframes)
  { key: 'X-Frame-Options',        value: 'DENY' },
  // Prevent MIME-type sniffing
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Don't send referrer to external sites
  { key: 'Referrer-Policy',        value: 'strict-origin-when-cross-origin' },
  // Restrict dangerous browser features
  { key: 'Permissions-Policy',     value: 'camera=(), microphone=(), geolocation=()' },
  // Force HTTPS for 1 year
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  // Content Security Policy — allow wagmi/RainbowKit CDN resources + Robinhood Chain RPC
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' 'unsafe-inline'",   // Next.js requires unsafe-eval in dev
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self' https: wss:",                    // RPC calls (HTTPS/WSS)
      "frame-ancestors 'none'",                            // Belt-and-suspenders for clickjacking
    ].join('; '),
  },
]

const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
}

module.exports = nextConfig
