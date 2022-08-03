import { existsSync, promises as fs } from 'fs'
import path from 'path'
import Router from '@koa/router'
import fp from 'functional-promises'
import { nanoid } from 'nanoid'
import { UserInputError } from 'apollo-server-core'

import { readJson, importDefault } from '../utilities.mjs'
import GraphqlMiddleware from './GraphqlMiddleware.mjs'

const loadProject = async name => {
  const router = new Router({ prefix: `/:projectName` })

  const projectPath = path.join(process.cwd(), `/colours/projects/${name}`)

  const { meta, ...apolloOptions } = await fp.all({
    meta: readJson(path.join(projectPath, 'meta.json')),
    typeDefs: importDefault(path.join(projectPath, 'typeDefs.mjs')),
    resolvers: importDefault(path.join(projectPath, 'resolvers.mjs')),
  })

  apolloOptions.path = `/${name}/graphql`
  apolloOptions.context = () => ({ meta })

  router.get('/', async (ctx, next) => {
    ctx.body = meta

    await next()
  })

  router.all('/graphql', await GraphqlMiddleware(apolloOptions))

  const middleware = router.routes()

  return {
    meta,
    middleware,
  }
}

/** @type {(projectsDirectory: string) => Promise<{[alias:string]: import('koa').Middleware}>} */
const loadProjects = fp
  .chain()
  .then(fs.readdir)
  .then(async directories =>
    Object.fromEntries(
      await Promise.all(
        directories.map(async projectAlias => [
          projectAlias,
          await loadProject(projectAlias),
        ]),
      ),
    ),
  )
  .chainEnd()

const memory = {
  projects: undefined,
}

const ReloadProjects = projectsPath => async () => {
  const projects = await loadProjects(projectsPath)

  memory.projects = projects

  return projects
}

/** @type {(config: import('../server.mjs').Config, projectInput: Project) => Promise<void>} */
const CreateProject =
  projectsPath =>
  async ({ alias: inputAlias, name: inputName }) => {
    const id = nanoid()
    const alias =
      inputAlias || `${inputName.toLowerCase().replace(/\W+/g, '-')}-${id}`
    const name = inputName
    const projectPath = path.join(projectsPath, alias)

    if (existsSync(projectPath)) {
      throw new UserInputError('Project alias is taken', {
        messageCode: 'projectExists',
      })
    }

    await fs.mkdir(projectPath)

    await fp.all({
      meta: fs.writeFile(
        path.join(projectPath, 'meta.json'),
        JSON.stringify({ id, name }, null, 2),
      ),
      typeDefs: fs.writeFile(
        path.join(projectPath, 'typeDefs.mjs'),
        `import gql from 'graphql-tag'

      export default gql\`
        type CustomModel {
          name: String
        }
      
        type Query {
          customModels: [CustomModel!]!
        }
      
        schema {
          query: Query
        }
      \`\n`,
      ),
      resolvers: fs.writeFile(
        path.join(projectPath, 'resolvers.mjs'),
        `export default {
      Query: {
        customModels: () =>
          [...Array(100)].map((_, index) => ({ name: \`${name} \${index}\` })),
      },
    }\n`,
      ),
    })

    return {
      meta: {
        id,
        name,
        alias,
      },
    }
  }

/** @type {(config: import('../server.mjs').Config) => Promise<import('koa').Middleware>} */
const ProjectManager = async config => {
  const reloadProjects = ReloadProjects(config.paths.projects)
  const createProject = CreateProject(config.paths.projects)

  await reloadProjects()

  return async (ctx, next) => {
    ctx.state.projects = memory.projects
    ctx.state.reloadProjects = reloadProjects
    ctx.state.createProject = createProject

    await next()
  }
}

export default ProjectManager
