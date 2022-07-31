import { promises as fs } from 'fs'
import path from 'path'
import Koa from 'koa'
import Router from '@koa/router'
import { ApolloServer } from 'apollo-server-koa'

const loadProject = async name => {
  const router = new Router({ prefix: `/projects/:name` })

  const projectPath = path.join(process.cwd(), `/colours/projects/${name}`)

  const meta = JSON.parse(
    await fs.readFile(path.join(projectPath, '.meta.json')),
  )

  const { default: typeDefs } = await import(
    path.join(projectPath, 'typeDefs.mjs')
  )
  const { default: resolvers } = await import(
    path.join(projectPath, 'resolvers.mjs')
  )

  router.all('/', async (ctx, next) => {
    ctx.body = meta
    await next()
  })

  const apolloServer = new ApolloServer({
    typeDefs: typeDefs(),
    resolvers: resolvers(),
    context: () => ({ meta }),
  })
  await apolloServer.start()

  const apolloMiddleware = apolloServer.getMiddleware({
    path: `/projects/${name}/graphql`,
  })

  router.all('/graphql', apolloMiddleware)

  return router.routes()
}

const loadProjects = async () => {
  const projectsPath = path.join(process.cwd(), '/colours/projects')
  const ls = await fs.readdir(projectsPath)

  return Object.fromEntries(
    await Promise.all(ls.map(async name => [name, await loadProject(name)])),
  )
}

let projects = undefined
const projectManager = async (ctx, next) => {
  if (!projects) {
    projects = await loadProjects()
  }

  ctx.state.projects = projects

  await next()
}

const dynamicRouter = async (ctx, next) => {
  const project = ctx.state.projects[ctx.params.name]

  if (!project) {
    ctx.body = 'project does not exist'
    ctx.status = 404
    return await next()
  }

  try {
    await project(ctx, next)
  } catch (error) {
    console.error({ error })
  }
}

const start = () => {
  const koa = new Koa()
  const router = new Router({ prefix: '/projects/:name' })

  koa.use(projectManager)

  router.all(['/', '/graphql'], dynamicRouter)

  koa.use(router.routes()).use(router.allowedMethods())

  koa.listen(8000)

  console.info('running', koa)
}

start()
