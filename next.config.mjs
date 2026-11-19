/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // NEXT_DIST_DIR lets a second instance (e.g. a localnet test server) build without clobbering `next dev`'s .next
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["@coral-xyz/anchor", "@solana/web3.js", "@solana/spl-token"],
};
export default nextConfig;
