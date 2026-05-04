import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    '/api/translate': ['./prompt_en_to_linkedin.md', './prompt_linkedin_to_en.md'],
  },
};

export default nextConfig;
