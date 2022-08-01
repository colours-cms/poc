import { promises as fs } from 'fs'
import path from 'path'
import Koa from 'koa'
import Router from '@koa/router'
import { ApolloServer } from 'apollo-server-koa'
import fp from 'functional-promises'
import gql from 'graphql-tag'
import { ApolloServerPluginLandingPageGraphQLPlayground } from 'apollo-server-core'

const readJson = fp.chain().then(fs.readFile).then(JSON.parse).chainEnd()
const importDefault = fp
  .chain()
  .then(async file => (await import(file)).default)
  .chainEnd()

const GraphqlMiddleware = fp
  .chain()
  .then(async ({ path, ...apolloServerOptions }) => {
    const apolloServer = new ApolloServer({
      ...apolloServerOptions,
      plugins: [ApolloServerPluginLandingPageGraphQLPlayground()],
    })

    await apolloServer.start()

    const apolloMiddleware = apolloServer.getMiddleware({ path })

    return apolloMiddleware
  })
  .chainEnd()

const loadProject = async name => {
  const router = new Router({ prefix: `/:projectName` })

  const projectPath = path.join(process.cwd(), `/colours/projects/${name}`)

  const { meta, ...apolloOptions } = await fp.all({
    meta: readJson(path.join(projectPath, 'meta.json')),
    typeDefs: importDefault(path.join(projectPath, 'typeDefs.mjs')),
    resolvers: importDefault(path.join(projectPath, 'resolvers.mjs')),
  })

  apolloOptions.path = `/${name}/graphql`
  apolloOptions.context = () => {
    console.debug({ context: name })
    return { meta }
  }

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

/**
 * @typedef ProjectMiddleware
 * @type {import('koa').KoaMiddleware}
 */

/** @type {async (projectsDirectory: string) => {[alias:string]: ProjectMiddleware}} */
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

const port = 8000

const typeDefs = gql`
  type Project {
    id: ID!
    name: String!
    url: String!
    graphqlUrl: String!
  }

  type Query {
    projects: [Project!]!
  }

  schema {
    query: Query
  }
`

const resolvers = {
  Query: {
    projects: (_, __, { projects = {} }) =>
      Object.entries(projects).map(([alias, { meta }]) => {
        const url = `/${alias}`
        const graphqlUrl = `${url}/graphql`

        return {
          ...meta,
          url,
          graphqlUrl,
        }
      }),
  },
}

const start = async () => {
  const koa = new Koa()

  const projectsPath = path.join(process.cwd(), '/colours/projects')
  koa
    .use(await ProjectManager(projectsPath))
    .use(
      await GraphqlMiddleware({ typeDefs, resolvers, context: () => memory }),
    )
    .use(ProjectRouter())

  koa.listen(port)
}

start().then(() => {
  console.info(`ready => http://localhost:${port}`)
})
