import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import assert from 'node:assert'

import Router from '@koa/router'
import fp from 'functional-promises'
import { nanoid } from 'nanoid'
import { UserInputError } from 'apollo-server-core'

import { readJson, importDefault } from '../utilities.mjs'
import GraphqlMiddleware from './GraphqlMiddleware.mjs'
import Prisma from '../prisma.mjs'
import { GraphQLError } from 'graphql'

/**
 * @typedef {{
 *   id: string
 *   alias: string
 *   name: string
 *   directory: string
 * }} Project
 */

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

/** @type {(string?: string) => string} */
const aliasify = string => string?.replace(/\W+/gi, '-').replace(/^-|-$/g, '')

/**
 *  @typedef {Partial<Omit<Project, 'id' | 'directory'>>} ProjectInput
 *
 *  @type {(projectsPath: string) => (projectInput?: ProjectInput) => Promise<void>}
 */
const CreateProject =
  projectsPath =>
  async (input = {}) => {
    if (input.alias) {
      const nonWordCharacters = input.alias.replace(/\w/, '')

      assert(
        !/\W/.test(alias),
        new UserInputError(
          `Alias cannot contain non-word (\\W) characters: '${nonWordCharacters}'`,
          {
            messageCode: 'aliasIllegal',
          },
        ),
      )
    }

    const id = nanoid()
    const name = input.name?.trim() || id
    const alias = input.alias || aliasify(input.name) || id

    assert(
      alias.length > 2,
      new UserInputError(
        `Alias must be at least 3 characters long: '${alias}'`,
        {
          messageCode: 'aliasShort',
        },
      ),
    )

    const directory = path.join(projectsPath, alias)

    // assert(
    //   !existsSync(directory),
    //   new UserInputError(`Project alias '${alias}' is taken`, {
    //     messageCode: 'projectExists',
    //   }),
    // )

    // await fs.mkdir(directory)

    /** @type {Project} */
    const project = {
      id,
      name,
      alias,
      directory,
    }

    const prisma = Prisma({ project })
    try {
      await prisma.init({
        datasourceProvider: 'mongodb',
        url: `mongodb+srv://root:root@localhost/${project.alias}?retryWrites=true&w=majority`,
      })
      await prisma.migrate()
    } catch (error) {
      throw new GraphQLError(error.message, { out: error.out })
    }

    await fp.all({
      meta: fs.writeFile(
        path.join(directory, 'meta.json'),
        JSON.stringify({ id, name }, null, 2),
      ),
      typeDefs: fs.writeFile(
        path.join(directory, 'typeDefs.mjs'),
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
        path.join(directory, 'resolvers.mjs'),
        `export default {
      Query: {
        customModels: () =>
          [...Array(100)].map((_, index) => ({ name: \`${name} \${index}\` })),
      },
    }\n`,
      ),
    })

    return { meta: project }
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
