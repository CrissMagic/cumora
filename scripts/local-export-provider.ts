/** Project trusted Windows connection settings for a Linux source-build trial. */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { prepareCodexProvider } from '../server/src/agents/computer/codex-provider.js'

const config = JSON.parse(await readFile(resolve('.local/config.json'), 'utf8')) as { codexPath: string }
const provider = await prepareCodexProvider(config.codexPath, process.env)
const settings: string[] = []
for (let index = 0; index < provider.args.length; index += 2) {
  const value = provider.args[index + 1]
  if (provider.args[index] !== '-c' || !/^(model|model_provider|model_providers|openai_base_url|model_catalog_json)=/.test(value)) {
    throw new Error('Unexpected provider projection field')
  }
  settings.push(value.startsWith('model_catalog_json=') ? 'model_catalog_json="models.json"' : value)
}
const catalog = provider.catalogFile ? await readFile(provider.catalogFile, 'utf8') : null
await writeFile(resolve('.local/wsl-provider.json'), JSON.stringify({ settings, catalog }), { mode: 0o600 })
console.log('Projected only Codex connection settings for the local WSL runtime; no hooks, tools or execution policy copied.')
