import { exec } from 'node:child_process'

/**
 * @typedef {{
 *   project: import('./middlewares/ProjectManager.mjs').Project
 * }} PrismaConfig
 */

/**
 * @typedef {{
 *   exec: (command: string, options: import('node:child_process').ExecOptions) => Promise<[error: import('node:child_process').ExecException | null, stdout: string, stderr: string]>
 * }} PrismaContext
 */

/**
 * @template T
 * @typedef {(options: T) => Promise<[error: Error, output: string]>} PrismaMethod
 */

/**
 * @typedef {{
 *   init: PrismaMethod<PrismaInitOptions>
 *   migrate: PrismaMethod<any>
 * }} PrismaInstance
 */

/**
 * @typedef {'sqlite' | 'postgresql' | 'mysql' | 'sqlserver' | 'mongodb' | 'cockroachdb'} PrismaDatasourceProvider Specifies the default value for the provider field in the datasource block.
 */

/**
 * @typedef {string} PrismaDatasourceUrl Define a custom datasource url.
 */

/**
 * @typedef {{
 *   datasourceProvider: PrismaDatasourceProvider
 *   url: PrismaDatasourceUrl
 * }} PrismaInitOptions
 */

/**@type {(error: import('node:child_process').ExecException, out: string) => Error} */
const PrismaError = (error, out) => {
  const result = new Error(out)
  result.out = out
  return out
}

/** @type {(config: PrismaConfig, context: PrismaContext) => PrismaMethod<PrismaInitOptions>} */
const Init =
  (_, { exec }) =>
  (options = {}) => {
    const arguments_ = Object.entries(options)
      .map(([key, value]) => {
        const kebab = key.replace(
          /[A-Z]/,
          match => `-${match.toLocaleLowerCase()}`,
        )

        const argument = `--${kebab}`

        if (value === true) {
          return argument
        }

        return [argument, `'${value}'`]
      })
      .flat()

    const argumentsString = arguments_.join(' ')

    return exec(`npx prisma init ${argumentsString}`)
  }

/** @type {(config: PrismaConfig, context: PrismaContext) => PrismaMethod<any>} */
const Migrate =
  (_, { exec }) =>
  () =>
    exec('npx prisma migrate')

/** @type {(config: PrismaConfig) => PrismaInstance} */
const Prisma = config => {
  const context = {
    exec: (command, options) =>
      new Promise(resolve => {
        exec(
          command,
          { ...options, cwd: config.project.directory },
          (error, standardOut, standardError) => {
            const out = standardError || standardOut

            if (error) {
              throw PrismaError(error, out)
            }

            resolve([error, out])
          },
        )
      }),
  }

  return {
    init: Init(config, context),
    migrate: Migrate(config, context),
  }
}

export default Prisma
