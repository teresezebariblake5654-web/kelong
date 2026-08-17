import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';

// https://vitejs.dev/config/
// PORT lets tooling (e.g. browser preview) assign a free port; electron:dev
// pins 5175 via the --port CLI flag, which overrides server.port anyway.
const devPort = Number(process.env.PORT ?? '') || 5175;
const katexVersion = process.env.npm_package_dependencies_katex?.replace(/^[~^]/, '') || '0.16.0';
const pdfJsAssetRoot = path.resolve(__dirname, 'node_modules/pdfjs-dist');
const pdfJsPublicPath = '/pdfjs/';
const pdfJsAssetDirs = [
  { route: `${pdfJsPublicPath}cmaps/`, source: path.join(pdfJsAssetRoot, 'cmaps'), output: 'cmaps' },
  { route: `${pdfJsPublicPath}standard_fonts/`, source: path.join(pdfJsAssetRoot, 'standard_fonts'), output: 'standard_fonts' },
];

function servePdfJsAsset(
  reqUrl: string | undefined,
  res: import('http').ServerResponse,
  next: () => void,
): void {
  if (!reqUrl) {
    next();
    return;
  }

  const pathname = new URL(reqUrl, 'http://localhost').pathname;
  const assetDir = pdfJsAssetDirs.find(dir => pathname.startsWith(dir.route));
  if (!assetDir) {
    next();
    return;
  }

  const relativePath = decodeURIComponent(pathname.slice(assetDir.route.length));
  const assetPath = path.resolve(assetDir.source, relativePath);
  if (!assetPath.startsWith(assetDir.source + path.sep)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  if (!fs.existsSync(assetPath) || !fs.statSync(assetPath).isFile()) {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }

  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  fs.createReadStream(assetPath).pipe(res);
}

function pdfJsStaticAssetsPlugin(): Plugin {
  return {
    name: 'pdfjs-static-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        servePdfJsAsset(req.url, res, next);
      });
    },
    writeBundle(outputOptions) {
      const outputDir = outputOptions.dir || path.resolve(__dirname, 'dist');
      const targetRoot = path.resolve(outputDir, `.${pdfJsPublicPath}`);
      for (const assetDir of pdfJsAssetDirs) {
        const targetDir = path.join(targetRoot, assetDir.output);
        fs.rmSync(targetDir, { recursive: true, force: true });
        fs.mkdirSync(path.dirname(targetDir), { recursive: true });
        fs.cpSync(assetDir.source, targetDir, { recursive: true });
      }
    },
  };
}

export default defineConfig(({ command }) => {
  // `vite` / `electron:dev` = serve; `vite build` / packaging = build.
  // Dev OOM was driven by repeatedly bundling ~10MB electron main + maps.
  const isServe = command === 'serve';
  // Keep renderer maps in prod builds; skip heavy maps while the long-lived
  // Vite watcher is running so Node heap stays under the default ~4GB limit.
  const electronSourcemap = isServe ? false : true;
  const rendererSourcemap = isServe ? false : true;

  return {
  define: {
    // KaTeX ESM bundle references this compile-time constant.
    __VERSION__: JSON.stringify(katexVersion),
  },
  plugins: [
    react(),
    pdfJsStaticAssetsPlugin(),
    electron([
      {
        // 主进程入口文件
        entry: 'src/main/main.ts',
        vite: {
          build: {
            sourcemap: electronSourcemap,
            outDir: 'dist-electron',
            minify: false,
            // Avoid gzip-size reporting on every main-process rebuild (saves CPU + peak RAM).
            reportCompressedSize: false,
            rollupOptions: {
              external: (id) => {
                const staticExternals = ['better-sqlite3', 'discord.js', 'zlib-sync', '@discordjs/opus', 'bufferutil', 'utf-8-validate', 'node-nim', 'nim-web-sdk-ng'];
                if (staticExternals.includes(id)) return true;
                if (id.startsWith('@larksuite/openclaw-lark-tools') || id.startsWith('@larksuite/openclaw-lark')) return true;
                return false;
              },
              output: {
                // Keep CJS format (default), but load via ESM loader.mjs
                inlineDynamicImports: true,
              },
            },
          },
        },
        onstart() {
          // Signal that the main process bundle is ready for electron to load
          fs.writeFileSync('dist-electron/.electron-ready', '');
        },
      },
      {
        // 预加载脚本入口文件
        entry: 'src/main/preload.ts',
        vite: {
          build: {
            sourcemap: electronSourcemap,
            outDir: 'dist-electron',
            minify: false,
            reportCompressedSize: false,
          },
        },
        onstart() {},
      },
      {
        // Sandboxed webview preload used only for browser annotations.
        entry: 'src/main/browserAnnotationPreload.ts',
        vite: {
          build: {
            sourcemap: electronSourcemap,
            outDir: 'dist-electron',
            minify: false,
            reportCompressedSize: false,
          },
        },
        onstart() {},
      },
    ]),
    renderer(),
  ],
  base: process.env.NODE_ENV === 'development' ? '/' : './',
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, './src/shared'),
      '@': path.resolve(__dirname, './src/renderer'),
      '@workstation': path.resolve(__dirname, './src/renderer/workstation'),
      '@aw/shared': path.resolve(__dirname, './workstation-packages/shared/src'),
      '@aw/task-templates': path.resolve(__dirname, './workstation-packages/task-templates/src'),
      '@aw/task-workflows': path.resolve(__dirname, './workstation-packages/task-workflows/src'),
      '@aw/data-engine': path.resolve(__dirname, './workstation-packages/data-engine/src'),
      // Browser shims for Node builtins pulled in by workstation packages
      crypto: path.resolve(__dirname, './src/renderer/workstation/shims/node-crypto.ts'),
      'node:crypto': path.resolve(__dirname, './src/renderer/workstation/shims/node-crypto.ts'),
      fs: path.resolve(__dirname, './src/renderer/workstation/shims/node-fs.ts'),
      'node:fs': path.resolve(__dirname, './src/renderer/workstation/shims/node-fs.ts'),
      path: path.resolve(__dirname, './src/renderer/workstation/shims/node-path.ts'),
      'node:path': path.resolve(__dirname, './src/renderer/workstation/shims/node-path.ts'),
      '@tauri-apps/api': path.resolve(__dirname, './src/renderer/workstation/shims/tauri-stub.ts'),
      '@tauri-apps/api/core': path.resolve(__dirname, './src/renderer/workstation/shims/tauri-stub.ts'),
      '@tauri-apps/plugin-dialog': path.resolve(__dirname, './src/renderer/workstation/shims/tauri-stub.ts'),
      '@tauri-apps/plugin-fs': path.resolve(__dirname, './src/renderer/workstation/shims/tauri-stub.ts'),
      '@tauri-apps/plugin-shell': path.resolve(__dirname, './src/renderer/workstation/shims/tauri-stub.ts'),
      '@tauri-apps/plugin-http': path.resolve(__dirname, './src/renderer/workstation/shims/tauri-stub.ts'),
      '@tauri-apps/plugin-os': path.resolve(__dirname, './src/renderer/workstation/shims/tauri-stub.ts'),
      '@tauri-apps/plugin-process': path.resolve(__dirname, './src/renderer/workstation/shims/tauri-stub.ts'),
      '@tauri-apps/plugin-updater': path.resolve(__dirname, './src/renderer/workstation/shims/tauri-stub.ts'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: rendererSourcemap,
    minify: false,
    reportCompressedSize: false,
  },
  server: {
    port: devPort,
    strictPort: true,
    host: true,
    hmr: {
      port: devPort,
    },
    watch: {
      usePolling: false,
      // Ignore heavy / generated trees so packaging + electron output cannot
      // thrash the watcher or lock files (previous EBUSY / OOM triggers).
      ignored: [
        '**/vendor/**',
        '**/release/**',
        '**/build-tar/**',
        '**/dist/**',
        '**/dist-electron/**',
        '**/logs/**',
        '**/*.tgz',
        '**/upload.tar',
      ],
    },
  },
  optimizeDeps: {
    exclude: ['electron', '@larksuite/openclaw-lark-tools', '@larksuite/openclaw-lark'],
    esbuildOptions: {
      define: {
        __VERSION__: JSON.stringify(katexVersion),
      },
      alias: {
        crypto: path.resolve(__dirname, './src/renderer/workstation/shims/node-crypto.ts'),
        'node:crypto': path.resolve(__dirname, './src/renderer/workstation/shims/node-crypto.ts'),
      },
    },
  },
  clearScreen: false,
  };
});
