import { defineConfig } from 'tsdown'

export default defineConfig(['index'].map(name => ({ entry: [`lib/types/${name}.js`], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024', fixedExtension: false, dts: false, clean: false })))
