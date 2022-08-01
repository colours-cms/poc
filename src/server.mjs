import { existsSync, promises as fs } from 'fs'
import path from 'path'
import Koa from 'koa'
import Router from '@koa/router'
import fp from 'functional-promises'
import gql from 'graphql-tag'
import { nanoid } from 'nanoid'

import GraphqlMiddleware from './middlewares/GraphqlMiddleware.mjs'
import ConfigMiddleware from './middlewares/ConfigMiddleware.mjs'
import { readJson, importDefault } from './utilities.mjs'
import { UserInputError } from 'apollo-server-core'
import UrlString from './graphql/types/UrlString.mjs'

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

const ProjectManager = async projectsPath => {
  const projects = await loadProjects(projectsPath)

  memory.projects = projects

  return async (ctx, next) => {
    ctx.state.projects = memory.projects

    await next()
  }
}

const ProjectRouter = () => {
  const router = new Router({ prefix: '/:projectName' })

  router.all(['/', '/graphql'], async (ctx, next) => {
    const project = ctx.state.projects[ctx.params.projectName]

    if (!project) {
      ctx.body = {
        errors: [
          {
            message: 'project does not exist',
            messageCode: 'projectDoesNotExist',
          },
        ],
      }
      ctx.status = 404

      return
    }
    ctx.state.project = project

    const { middleware } = project

    try {
      await middleware(ctx, next)
    } catch (error) {
      console.error({ error })
    }
  })

  const routes = router.routes()

  return routes
}

/**
 * @typedef {{
 *   server: {
 *     port: number
 *   }
 *   paths: {
 *     projects: string
 *   }
 * }} Config
 */

/**
 * @typedef {{
 *   id: string
 *   alias: string
 *   name: ?string
 * }} Project
 */

/** @type {(config: Config, projectInput: Project) => Promise<void>} */
const createProject = async (
  config,
  { alias: inputAlias, name: inputName },
) => {
  const id = nanoid()
  const alias =
    inputAlias || `${inputName.toLowerCase().replace(/\W+/g, '-')}-${id}`
  const name = inputName
  const projectPath = path.join(config.paths.projects, alias)

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

const typeDefs = gql`
  type Project {
    id: ID!
    alias: String!
    name: String!
    url: String!
    graphqlUrl: String!
  }

  type Query {
    projects: [Project!]!
    reloadProjects: [Project!]!
  }

  scalar UrlString

  input ProjectInput {
    name: String!
    """
    Used for folders & urls. Will be generated based on name and id if omitted.
    """
    alias: UrlString
  }

  type Mutation {
    createProject(input: ProjectInput!): Project!
  }

  schema {
    query: Query
    mutation: Mutation
  }
`

const resolvers = {
  Project: {
    url: meta => `/${meta.alias}`,
    graphqlUrl: meta => `/${meta.alias}/graphql`,
  },
  UrlString,
  Query: {
    /** @type {import('graphql').GraphQLFieldResolver} */
    projects: (_, __, { projects = {} }) =>
      Object.entries(projects).map(([alias, { meta }]) => ({ ...meta, alias })),
    reloadProjects: async (_, __, { config }) => {
      const projects = await loadProjects(config.paths.projects)

      memory.projects = projects

      return Object.entries(projects).map(([alias, { meta }]) => ({
        ...meta,
        alias,
      }))
    },
  },
  Mutation: {
    /** @type {import('graphql').GraphQLFieldResolver} */
    createProject: async (_, { input }, { config }) => {
      const { meta } = await createProject(config, input)

      return meta
    },
  },
}

/** @type {Config} */
const config = {
  server: {
    port: 8000,
  },
  paths: {
    projects: path.join(process.cwd(), '/colours/projects'),
  },
}

/** @type {() => Promise<Config>} */
const start = async () => {
  const koa = new Koa()

  koa
    .use(ConfigMiddleware(config))
    .use(await ProjectManager(config.paths.projects))
    .use(
      await GraphqlMiddleware({
        typeDefs,
        resolvers,
        context: () => ({
          ...memory,
          config,
        }),
      }),
    )
    .use(ProjectRouter())

  koa.listen(config.server.port)

  return config
}

start().then(config => {
  console.info(`ready => http://localhost:${config.server.port}`)
})
