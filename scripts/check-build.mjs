import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve, sep } from 'node:path'
import { productionAssets } from './build-contract.mjs'

// Check the artifact that Pages uploads, not the development source tree.
const dist = resolve(fileURLToPath(new URL('../dist/', import.meta.url)))
const html = await readFile(resolve(dist, 'index.html'), 'utf8')
for (const path of productionAssets(html)) {
  const target = resolve(dist, '.' + path)
  assert.ok(target.startsWith(dist + sep), 'Asset must stay inside dist')
  assert.ok((await stat(target)).isFile(), 'Missing production asset')
}
console.log('OK: Flow metadata and root-based JavaScript/CSS exist in dist/.')
