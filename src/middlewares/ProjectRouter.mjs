import Router from '@koa/router'

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

export default ProjectRouter
