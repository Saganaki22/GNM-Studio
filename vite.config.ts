import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

const packageVersion = (JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string }).version

function webRuntimeAssetPlugin(): Plugin {
  return {
    name: 'gnm-web-identity-asset',
    buildStart() {
      this.emitFile({
        type: 'asset',
        fileName: 'models/gnm_identity_basis.gni.gz',
        source: readFileSync(new URL('./webapp-assets/models/gnm_identity_basis.gni.gz', import.meta.url)),
      })
      this.emitFile({
        type: 'asset',
        fileName: 'models/gnm_expression_basis.gne.gz',
        source: readFileSync(new URL('./webapp-assets/models/gnm_expression_basis.gne.gz', import.meta.url)),
      })
    },
  }
}

const desktopDinoRoot = new URL(
  './desktop-assets/models/huggingface/onnx-community/dinov3-vits16-pretrain-lvd1689m-ONNX/',
  import.meta.url,
)
const desktopDinoFiles = [
  'config.json',
  'preprocessor_config.json',
  'LICENSE.md',
  'onnx/model_q4.onnx',
  'onnx/model_q4.onnx_data',
] as const

function desktopDinoAssetPlugin(): Plugin {
  return {
    name: 'gnm-desktop-dinov3-assets',
    apply: 'build',
    buildStart() {
      for (const file of desktopDinoFiles) {
        this.emitFile({
          type: 'asset',
          fileName: `models/huggingface/onnx-community/dinov3-vits16-pretrain-lvd1689m-ONNX/${file}`,
          source: readFileSync(new URL(file, desktopDinoRoot)),
        })
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const webBuild = mode === 'web'
  return {
    // Project Pages is hosted below the account's custom-domain root.
    base: webBuild ? '/GNM-Studio/' : '/',
    plugins: [
      react(),
      ...(webBuild ? [webRuntimeAssetPlugin()] : [desktopDinoAssetPlugin()]),
    ],
    define: {
      __APP_VERSION__: JSON.stringify(packageVersion),
      __GNM_WEB_BUILD__: JSON.stringify(webBuild),
    },
    build: {
      outDir: webBuild ? 'gh-pages' : 'dist',
      // Three.js is the large always-on renderer; keeping it separate improves
      // cache reuse. Mediabunny and its AAC encoder are already lazy chunks that
      // load only when a WebM take actually needs MP4 conversion.
      chunkSizeWarningLimit: 1100,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: 'three', test: /node_modules[\\/]three[\\/]/, priority: 20 },
              { name: 'react', test: /node_modules[\\/](react|react-dom)[\\/]/, priority: 10 },
            ],
          },
        },
      },
    },
  }
})
