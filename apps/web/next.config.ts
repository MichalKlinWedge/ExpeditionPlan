import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pakiety z monorepo są publikowane jako źródła TypeScript — Next musi je skompilować sam.
  transpilePackages: ["@expeditionplan/core", "@expeditionplan/sync", "@expeditionplan/db", "@expeditionplan/ai", "@expeditionplan/planner"],
  cacheComponents: true,
  experimental: {
    // Import rezerwacji wysyła plik (PDF, zrzut ekranu) do akcji serwera; Vercel przyjmuje do 4,5 MB.
    serverActions: { bodySizeLimit: "4mb" },
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
