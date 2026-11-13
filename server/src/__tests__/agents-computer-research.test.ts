import assert from 'node:assert/strict'
import { test } from 'node:test'
import { researchCommand } from '../agents/computer/research.js'
import { fetchPublicText } from '../agents/image-fetcher.js'

const page = (body: string) => ({ ok: true as const, buffer: Buffer.from(body), mime: 'text/html', bytes: body.length, finalUrl: 'https://news.example/announcement' })

test('research returns source provenance and treats RSS dates as feed dates', async () => {
  const result = await researchCommand(['research', 'search', 'site:news.example new CEO'], async (url) => {
    const query = new URL(url)
    assert.equal(query.origin, 'https://www.bing.com')
    assert.equal(query.searchParams.get('q'), 'site:news.example new CEO')
    return page('<rss><channel><item><title>New &amp; verified</title><link>https://news.example/announcement</link><description><![CDATA[<b>New CEO</b> announced]]></description><pubDate>12 Nov 2026</pubDate></item><item><title>off topic</title><link>https://unrelated.example/</link></item></channel></rss>')
  })
  assert.equal(result.exitCode, 0)
  const data = JSON.parse(result.text.split('\n')[1])
  assert.equal(data.results.length, 1)
  assert.deepEqual(data.results[0], { title: 'New & verified', url: 'https://news.example/announcement', snippet: 'New CEO announced', feedDate: '12 Nov 2026' })
  assert.ok(data.retrievedAt)
  assert.match(data.notice, /not article publication dates/)
})

test('reading a page removes scripts, bounds model input, and retains its URL', async () => {
  const result = await researchCommand(['research', 'read', 'https://news.example/announcement'], async () =>
    page(`<title>Official statement</title><script>secretScript()</script><p>Confirmed CEO</p>${'x'.repeat(20_000)}`))
  const data = JSON.parse(result.text.split('\n')[1])
  assert.equal(result.exitCode, 0)
  assert.equal(data.url, 'https://news.example/announcement')
  assert.match(data.text, /Confirmed CEO/)
  assert.doesNotMatch(data.text, /secretScript/)
  assert.equal(data.text.length, 16_000)
  assert.equal(data.truncated, true)
})

test('network failures, captchas and invalid input never become verified evidence', async () => {
  for (const argv of [['research', 'read', 'file:///secret'], ['research', 'read', 'https://user:secret@example.com'], ['research', 'read', 'https://example.com:5181'], ['research', 'search', 'x'.repeat(501)]]) {
    const result = await researchCommand(argv, async () => { throw new Error('must not fetch') })
    assert.equal(result.exitCode, 1)
    assert.doesNotMatch(result.text, /must not fetch/)
  }
  assert.match((await researchCommand(['research', 'search', 'news'], async () => page('<html>captcha</html>'))).text, /not verified/)
  assert.match((await researchCommand(['research', 'read', 'https://example.com'], async () => ({ ok: false, reason: 'timeout' }))).text, /not verified/)
})

test('public text denies loopback, mixed public/private DNS and internal redirects before connecting', async () => {
  let connections = 0
  const response = (status: number, headers: Record<string, string>) => ({ status, headers,
    body: (async function* () { yield Buffer.from('page') })(), cancel() {} })
  const request = async () => { connections += 1; return response(200, { 'content-type': 'text/html' }) }
  const lookup = async () => [{ address: '1.1.1.1', family: 4 as const }, { address: '10.1.2.16', family: 4 as const }]
  for (const url of ['https://127.0.0.1', 'https://[::1]', 'https://169.254.169.254', 'https://mixed.example']) {
    assert.deepEqual(await fetchPublicText(url, {}, { lookup, request }), { ok: false, reason: 'blocked' })
  }
  assert.equal(connections, 0)
  const redirected = await fetchPublicText('https://public.example', {}, {
    lookup: async () => [{ address: '1.1.1.1', family: 4 }],
    request: async () => { connections += 1; return response(302, { location: 'http://127.0.0.1/private' }) },
  })
  assert.deepEqual(redirected, { ok: false, reason: 'blocked' })
  assert.equal(connections, 1)
})

test('public text pins its connection and enforces content and size limits', async () => {
  const dependencies = {
    lookup: async () => [{ address: '1.1.1.1', family: 4 as const }],
    request: async (target: { address: string }) => {
      assert.equal(target.address, '1.1.1.1')
      return { status: 200, headers: { 'content-type': 'text/html' }, body: (async function* () { yield Buffer.from('official source') })(), cancel() {} }
    },
  }
  assert.equal((await fetchPublicText('https://news.example', {}, dependencies)).ok, true)
  assert.deepEqual(await fetchPublicText('https://news.example', { maxBytes: 4 }, dependencies), { ok: false, reason: 'too-large' })
})
