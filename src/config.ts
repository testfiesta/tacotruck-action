import * as fs from 'node:fs'
import * as core from '@actions/core'
import * as github from '@actions/github'
import { z } from 'zod'

const baseConfigSchema = z.object({
  provider: z.union([z.literal('testrail'), z.literal('testfiesta')], {
    message: 'Provider must be one of: \'testrail\', \'testfiesta\'',
  }),
  handle: z.string().trim().min(1, 'Handle cannot be empty'),
  project: z.string().trim().min(1, 'Project cannot be empty'),
  resultsPath: z.string().trim().min(1, 'Results path cannot be empty'),
  credentials: z.string().min(1, 'Credentials cannot be empty'),
  baseUrl: z.url('Base URL must be a valid URL'),
  runName: z.string().trim().optional().default(() => `CI Run ${github.context.runId}`),
  failOnError: z.boolean().default(false),
})

const testRailConfigSchema = baseConfigSchema.extend({
  provider: z.literal('testrail'),
  project: z.string(),
})

const testfiestaConfigSchema = baseConfigSchema.extend({
  provider: z.literal('testfiesta'),
  project: z.string(),
})

export const providerConfigSchema = z.discriminatedUnion('provider', [
  testRailConfigSchema,
  testfiestaConfigSchema,
])

export type ZodTestRailConfig = z.infer<typeof testRailConfigSchema>
export type ZodTestfiestaConfig = z.infer<typeof testfiestaConfigSchema>
export type ZodProviderConfig = z.infer<typeof providerConfigSchema>

export function validateProviderConfig(config: ZodProviderConfig): void {
  try {
    if (!fs.existsSync(config.resultsPath)) {
      throw new Error(`Results path does not exist: ${config.resultsPath}`)
    }

    const stats = fs.statSync(config.resultsPath)
    if (!stats.isDirectory() && !stats.isFile()) {
      throw new Error(`Results path is not a valid file or directory: ${config.resultsPath}`)
    }

    try {
      if (stats.isDirectory()) {
        fs.readdirSync(config.resultsPath)
      }
      else {
        fs.accessSync(config.resultsPath, fs.constants.R_OK)
      }
    }
    // eslint-disable-next-line unused-imports/no-unused-vars
    catch (err) {
      throw new Error(`No read permission for results path: ${config.resultsPath}`)
    }
  }
  catch (error) {
    if (error instanceof Error) {
      throw error
    }
    throw new Error(`Error validating results path: ${String(error)}`)
  }
}

export async function parseConfiguration(): Promise<ZodProviderConfig> {
  const provider = core.getInput('provider', { required: true }).toLowerCase()
  const baseConfig = {
    provider,
    handle: core.getInput('handle', { required: true }),
    project: core.getInput('project', { required: true }),
    resultsPath: core.getInput('results-path', { required: true }),
    credentials: core.getInput('credentials', { required: true }),
    baseUrl: core.getInput('base-url', { required: true }),
    runName: core.getInput('run-name'),
    failOnError: core.getBooleanInput('fail-on-error'),
  }

  const configInput = core.getInput('config') || '{}'
  let providerConfig: any = {}

  try {
    providerConfig = JSON.parse(configInput)
  }
  catch (error) {
    throw new Error(`Invalid JSON in config input: ${error}`)
  }

  const configFile = core.getInput('config-file')
  if (configFile && fs.existsSync(configFile)) {
    try {
      const fileContent = fs.readFileSync(configFile, 'utf8')
      const fileConfig = JSON.parse(fileContent)
      providerConfig = { ...fileConfig, ...providerConfig }
    }
    catch (error) {
      core.warning(`Failed to read config file ${configFile}: ${error}`)
    }
  }

  let config: ZodProviderConfig

  try {
    switch (provider) {
      case 'testrail': {
        const rawConfig = {
          ...baseConfig,
          provider: 'testrail',
          suiteId: providerConfig.suite_id || providerConfig.suiteId,
          runName: providerConfig.run_name || providerConfig.runName,
          milestoneId: providerConfig.milestone_id || providerConfig.milestoneId,
          assignedTo: providerConfig.assigned_to || providerConfig.assignedTo,
        }

        config = testRailConfigSchema.parse(rawConfig)
        break
      }

      case 'testfiesta': {
        const rawConfig = {
          ...baseConfig,
          provider: 'testfiesta',
          environment: providerConfig.environment,
          tags: providerConfig.tags,
          branch: providerConfig.branch,
        }

        config = testfiestaConfigSchema.parse(rawConfig)
        break
      }

      default:
        throw new Error(`Unsupported provider: ${provider}. Supported providers: testrail, testfiesta`)
    }

    if (config.provider === 'testrail' && config.credentials) {
      const [username, apiKey] = config.credentials.split(':')
      if (!username || !apiKey) {
        throw new Error('TestRail credentials must be in the format "username:apikey"')
      }
    }

    return config
  }
  catch (error) {
    if (error instanceof z.ZodError) {
      const formattedErrors = error.issues.map(err =>
        `${err.path.join('.')}: ${err.message}`,
      ).join('\n- ')
      throw new Error(`Configuration validation failed:\n- ${formattedErrors}`)
    }
    if (error instanceof Error) {
      throw new TypeError(`Configuration error: ${error.message}`)
    }
    throw new Error(`Unknown configuration error: ${String(error)}`)
  }
}
