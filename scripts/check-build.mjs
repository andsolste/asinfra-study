import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve, sep } from 'node:path'

// Check the artifact that Pages uploads, not the development source tree.
const dist = resolve(fileURLToPath(new URL('../dist/', import.meta.url)))
const html = await readFile(resolve(dist, 'index.html'), 'utf8')
const references = [...html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)].map(match => match[1])
assert.ok(references.some(path => path.endsWith('.js')), 'Missing built JavaScript')
assert.ok(references.some(path => path.endsWith('.css')), 'Missing built CSS')
for (const path of references) {
  assert.ok(path.startsWith('/assets/'), 'Production asset must use the subdomain root /assets/')
  const target = resolve(dist, '.' + path)
  assert.ok(target.startsWith(dist + sep), 'Asset must stay inside dist')
  assert.ok((await stat(target)).isFile(), 'Missing production asset')
}
assert.ok(!html.includes('/study/'), 'Legacy Study base must not appear in production HTML')
console.log('OK: root-based index.html, JavaScript and CSS exist in dist/.')
