// Publishes each bot's status.json to the `bot-status` branch on GitHub every
// PUBLISH_INTERVAL_MS. The deployed website reads these via raw.githubusercontent
// -- a free, quota-free replacement for the maxed-out Upstash store. Uses git
// plumbing (hash-object/mktree/commit-tree) so it NEVER touches the working
// tree or the current branch. status.json holds only public data (addresses,
// balances, tx hashes) -- no keys -- exactly what the site already serves.
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import path from 'path'

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const INTERVAL = parseInt(process.env.PUBLISH_INTERVAL_MS ?? '60000')
// filename on the branch  ->  local status.json path (relative to repo root)
const FILES = { 'keeper.json': 'keeper/status.json', 'keeper2.json': 'keeper2/status.json' }

const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', windowsHide: true }).trim()

// Committed onto the bot-status branch itself so Vercel, which reads
// git.deploymentEnabled from the pushed branch's vercel.json, SKIPS building
// this branch. Without it Vercel tries to build a Next.js app out of two JSON
// files every push and fails -- spamming error deployments.
const VERCEL_JSON = JSON.stringify({ git: { deploymentEnabled: { 'bot-status': false } } })

function hashStdin(content) {
  return execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: REPO, input: content, encoding: 'utf8', windowsHide: true }).trim()
}

function publishOnce() {
  const entries = []
  for (const [name, rel] of Object.entries(FILES)) {
    try {
      const blob = git(['hash-object', '-w', rel])
      entries.push(`100644 blob ${blob}\t${name}`)
    } catch { /* that bot's status.json missing -- skip it */ }
  }
  if (!entries.length) return
  entries.push(`100644 blob ${hashStdin(VERCEL_JSON)}\tvercel.json`)
  const tree = execFileSync('git', ['mktree'], { cwd: REPO, input: entries.join('\n') + '\n', encoding: 'utf8', windowsHide: true }).trim()
  const commit = git(['commit-tree', tree, '-m', 'bot status snapshot'])
  git(['update-ref', 'refs/heads/bot-status', commit])
  git(['push', '-f', 'origin', 'bot-status'])
  console.log(`[${new Date().toISOString()}] published bot-status (${entries.length} bot(s))`)
}

publishOnce()
setInterval(() => { try { publishOnce() } catch (e) { console.error('publish failed:', e?.message ?? e) } }, INTERVAL)
