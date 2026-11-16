/** @type {import('next').NextConfig} */
const nextConfig = {
  // Shows the deployed build in responses and keeps local/prod naming consistent.
  env: {
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME ?? "Repurpose Studio",
  },
  // Native binaries / queue clients must stay outside the server bundle.
  serverExternalPackages: ["fluent-ffmpeg", "sharp", "@prisma/client", "bullmq", "ioredis"],
  experimental: {
    serverActions: {
      // Intro/outro clips, SRT files and thumbnails can be uploaded from the UI.
      bodySizeLimit: "25mb",
    },
  },
  images: {
    // Source thumbnails come from many CDNs; proxying them keeps the UI consistent.
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
};

export default nextConfig;
