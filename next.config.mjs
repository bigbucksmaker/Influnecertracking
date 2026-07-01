/** @type {import('next').NextConfig} */
const nextConfig = {
  // Type errors still fail the build (we want correctness); lint style issues don't block.
  eslint: { ignoreDuringBuilds: true },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "pbs.twimg.com" },
      { protocol: "https", hostname: "abs.twimg.com" },
    ],
  },
};

export default nextConfig;
