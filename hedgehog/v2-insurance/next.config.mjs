/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: false, // strict-mode double effects fired two concurrent wallet connects in dev ("Unexpected error")
  serverExternalPackages: ["@coral-xyz/anchor"],
  // Dev server is reached through Caddy (HTTPS) and the raw IP; allow those origins to load /_next dev assets.
  allowedDevOrigins: ["178-156-138-228.sslip.io", "178.156.138.228"],
};
