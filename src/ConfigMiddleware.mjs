const ConfigMiddleware = config => async (ctx, next) => {
  ctx.state.config = config

  await next()
}

export default ConfigMiddleware
