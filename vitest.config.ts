import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, './src/shared'),
      '@': path.resolve(__dirname, './src/renderer'),
      '@workstation': path.resolve(__dirname, './src/renderer/workstation'),
      '@aw/shared': path.resolve(__dirname, './workstation-packages/shared/src'),
      '@aw/task-templates': path.resolve(__dirname, './workstation-packages/task-templates/src'),
      '@aw/task-workflows': path.resolve(__dirname, './workstation-packages/task-workflows/src'),
      '@aw/data-engine': path.resolve(__dirname, './workstation-packages/data-engine/src'),
      '@tauri-apps/api': path.resolve(__dirname, './src/renderer/workstation/shims/tauri-stub.ts'),
      '@tauri-apps/api/core': path.resolve(__dirname, './src/renderer/workstation/shims/tauri-stub.ts'),
      '@tauri-apps/plugin-dialog': path.resolve(__dirname, './src/renderer/workstation/shims/tauri-stub.ts'),
      '@tauri-apps/plugin-fs': path.resolve(__dirname, './src/renderer/workstation/shims/tauri-stub.ts'),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
  },
});
