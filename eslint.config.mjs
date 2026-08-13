import { defineConfig } from '@vben/eslint-config';

export default defineConfig([
  {
    // admin-plus 迁入页：template ref 经 toRefs/state 使用，vue/no-unused-refs 误报
    files: ['apps/web-ele/src/**/*.{vue,ts,tsx}'],
    rules: {
      'vue/no-unused-refs': 'off',
    },
  },
]);
