import assert from 'node:assert/strict'

// Small contract for Vite's generated entry document, not a general HTML validator.
export function productionAssets(html) {
  const tags = [...html.matchAll(/<(script|link|meta)\b[^>]*>/gi)].map(match => ({
    tag: match[1].toLowerCase(),
    attrs: Object.fromEntries([...match[0].matchAll(/([\w:-]+)=["']([^"']*)["']/g)]
      .map(attr => [attr[1].toLowerCase(), attr[2]])),
  }))
  const canonicals = tags.filter(({ tag, attrs }) => tag === 'link' && attrs.rel === 'canonical')
  const ogUrls = tags.filter(({ tag, attrs }) => tag === 'meta' && attrs.property === 'og:url')
  assert.equal(canonicals.length, 1, 'Expected one production canonical')
  assert.equal(canonicals[0].attrs.href, 'https://flow.asinfra.no/', 'Incorrect production canonical')
  assert.equal(ogUrls.length, 1, 'Expected one production og:url')
  assert.equal(ogUrls[0].attrs.content, 'https://flow.asinfra.no/', 'Incorrect production og:url')

  const assets = tags.flatMap(({ tag, attrs }) => {
    if (tag === 'script' && attrs.src) return [attrs.src]
    if (tag === 'link' && attrs.rel !== 'canonical' && attrs.href) return [attrs.href]
    return []
  })
  assert.ok(assets.some(path => path.endsWith('.js')), 'Missing built JavaScript')
  assert.ok(assets.some(path => path.endsWith('.css')), 'Missing built CSS')
  for (const path of assets) {
    assert.ok(path.startsWith('/assets/'), 'Production asset must use the subdomain root /assets/')
  }
  assert.ok(!html.includes('/study/'), 'Legacy Study base must not appear in production HTML')
  return assets
}
