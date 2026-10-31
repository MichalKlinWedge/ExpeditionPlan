import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pakiety z monorepo są publikowane jako źródła TypeScript — Next musi je skompilować sam.
  transpilePackages: ["@expeditionplan/core", "@expeditionplan/sync", "@expeditionplan/db"],
  cacheComponents: true,
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
