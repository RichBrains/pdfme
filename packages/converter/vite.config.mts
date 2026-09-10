import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

const builtinModuleSet = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
]);
const packageDependencies = [
  ...Object.keys(packageJson.dependencies ?? {}),
  ...Object.keys(packageJson.peerDependencies ?? {}),
];

const isExternal = (id: string) =>
  builtinModuleSet.has(id) ||
  packageDependencies.some((dependency) => id === dependency || id.startsWith(`${dependency}/`));

export default defineConfig(() => {
  return {
    base: './',
    resolve: {
      alias: [
        // clawpdf resolves its WASM via bare `new URL("...pdfium.esm.wasm")`
        // references (Emscripten `findWasmBinary` fallback). In lib mode Vite
        // force-inlines those as ~5MB base64 `data:` URLs into the worker.
        // Point them at an empty stub instead: the worker always passes an
        // explicit `wasmUrl` to `createEngine` (see clawpdf-worker.ts), so
        // the inlined fallback is dead code. The lookahead keeps our real
        // `?url&no-inline` import resolving to the actual WASM file.
        {
          find: /pdfium\.esm\.wasm(?!.*no-inline)/,
          replacement: resolve(__dirname, 'src/empty-pdfium-stub.wasm'),
        },
      ],
    },
    build: {
      // PDFium's WASM must stay a separate file next to the worker: the
      // Emscripten loader fetches it via XHR/fetch, which cannot load the
      // `data:` URLs Vite would otherwise inline into the worker bundle.
      assetsInlineLimit: 0,
      lib: {
        entry: {
          index: resolve(__dirname, 'src/index.browser.ts'),
          'index.node': resolve(__dirname, 'src/index.node.ts'),
          md2pdf: resolve(__dirname, 'src/md2pdf.ts'),
        },
        fileName: (_, entryName) => `${entryName}.js`,
        formats: ['es'],
      },
      minify: false,
      outDir: 'dist',
      rollupOptions: { external: isExternal },
      sourcemap: true,
      target: 'es2020',
    },
  };
});
