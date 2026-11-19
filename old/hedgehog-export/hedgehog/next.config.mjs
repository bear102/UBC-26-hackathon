/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@coral-xyz/anchor", "@solana/web3.js", "@solana/spl-token"],
};
export default nextConfig;
