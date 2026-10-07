/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    // The engine and registry live in /lib as plain ES modules. They must be
    // importable from both the React app (browser) AND the Node smoke test
    // (scripts/test-engine.js). Keep /lib framework-free.
    experimental: {
        // Allow importing .js from anywhere; Next.js does this by default but
        // document the intent: nothing in /lib uses JSX or React.
    },
};

export default nextConfig;