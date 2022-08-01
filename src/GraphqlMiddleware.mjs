import { ApolloServer } from 'apollo-server-koa'
import { ApolloServerPluginLandingPageGraphQLPlayground } from 'apollo-server-core'
import fp from 'functional-promises'

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

export default GraphqlMiddleware
