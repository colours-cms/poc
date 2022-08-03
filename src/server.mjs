import path from 'path'
import Koa from 'koa'
import gql from 'graphql-tag'

import GraphqlMiddleware from './middlewares/GraphqlMiddleware.mjs'
import ConfigMiddleware from './middlewares/ConfigMiddleware.mjs'
import ProjectRouter from './middlewares/ProjectRouter.mjs'
import ProjectManager from './middlewares/ProjectManager.mjs'
import UrlString from './graphql/types/UrlString.mjs'

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
    projects: (_, __, { state: { projects = {} } }) =>
      Object.entries(projects).map(([alias, { meta }]) => ({ ...meta, alias })),
    reloadProjects: async (_, __, { state }) => {
      const projects = await state.reloadProjects()

      return Object.entries(projects).map(([alias, { meta }]) => ({
        ...meta,
        alias,
      }))
    },
  },
  Mutation: {
    /** @type {import('graphql').GraphQLFieldResolver} */
    createProject: async (_, { input }, { state }) => {
      const { meta } = await state.createProject(input)

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
    .use(await ProjectManager(config))
    .use(
      await GraphqlMiddleware({
        typeDefs,
        resolvers,
        context: ({ ctx }) => ({
          config,
          state: ctx.state,
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
