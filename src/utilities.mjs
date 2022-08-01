import { promises as fs } from 'fs'
import fp from 'functional-promises'

const readJson = fp.chain().then(fs.readFile).then(JSON.parse).chainEnd()
const importDefault = fp
  .chain()
  .then(async file => (await import(file)).default)
  .chainEnd()

export { readJson, importDefault }
