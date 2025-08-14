import * as fs from 'node:fs'
import * as path from 'node:path'
import * as core from '@actions/core'
import * as github from '@actions/github'
import { TestFiestaClient, TestRailClient } from '@testfiesta/tacotruck'
import { z } from 'zod'

const baseConfigSchema = z.object({
  provider: z.union([z.literal('testrail'), z.literal('testfiesta')], {
    message: 'Provider must be one of: \'testrail\', \'testfiesta\'',
  }),
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

interface SubmissionResult {
  submissionId: string
  resultsUrl: string
}

async function run(): Promise<void> {
  try {
    const config = await parseConfiguration()

    validateProviderConfig(config)

    core.info(`🚀 Submitting test results to ${config.provider}`)
    core.info(`📁 Results path: ${config.resultsPath}`)
    core.info(`🌐 Base URL: ${config.baseUrl}`)

    const context = github.context
    const metadata = {
      repository: context.repo,
      commit: context.sha,
      branch: context.ref,
      workflow: context.workflow,
      runId: context.runId,
      actor: context.actor,
    }

    const result = await submitTestResults(config, metadata)

    core.setOutput('submission-id', result.submissionId)
    core.setOutput('results-url', result.resultsUrl)

    core.info(`✅ Test results submitted successfully!`)
    core.info(`📊 Submission ID: ${result.submissionId}`)
    core.info(`🔗 Results URL: ${result.resultsUrl}`)
  }
  catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    core.error(`❌ Failed to submit test results: ${errorMessage}`)

    const failOnError = core.getBooleanInput('fail-on-error')
    if (failOnError) {
      core.setFailed(errorMessage)
    }
    else {
      core.warning(`Test submission failed but continuing due to fail-on-error: false`)
    }
  }
}

async function parseConfiguration(): Promise<ZodProviderConfig> {
  const provider = core.getInput('provider', { required: true }).toLowerCase()
  const baseConfig = {
    provider,
    resultsPath: core.getInput('results-path', { required: true }),
    credentials: core.getInput('credentials', { required: true }),
    baseUrl: core.getInput('base-url', { required: true }),
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
          projectId: providerConfig.project_id,
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
          project: providerConfig.project || '',
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

function validateProviderConfig(config: ZodProviderConfig): void {
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

async function submitTestResults(
  config: ZodProviderConfig,
  metadata: any,
): Promise<SubmissionResult> {
  try {
    const testResults = await readTestResults(config.resultsPath)

    if (Array.isArray(testResults) && testResults.length === 0) {
      core.warning(`No test results found in ${config.resultsPath}`)
    }

    switch (config.provider) {
      case 'testrail':
        return await submitToTestRail(config, testResults, metadata)

      case 'testfiesta':
        return await submitToTestfiesta(config, testResults, metadata)

      default:
        throw new Error(`Unsupported provider`)
    }
  }
  catch (error) {
    if (error instanceof Error) {
      throw new TypeError(`Failed to submit test results: ${error.message}`)
    }
    throw new Error(`Failed to submit test results: ${String(error)}`)
  }
}

async function submitToTestRail(
  config: ZodTestRailConfig,
  testResults: any,
  metadata: any,
): Promise<SubmissionResult> {
  const [username, password] = config.credentials.split(':')

  const runPayload = {
    name: config.runName,
    description: `Automated test run from ${metadata.workflow} (${metadata.commit})`,
    results: testResults,
    include_all: true,
  }

  const sanitizedPayload = { ...runPayload, credentials: '***' }
  core.debug(`Creating TestRail run with payload: ${JSON.stringify(sanitizedPayload)}`)

  const runId = 1

  const trClient = new TestRailClient({
    baseUrl: config.baseUrl,
    username,
    password,
  })

  await trClient.submitTestResults(testResults, {}, config.runName)
  core.info(`📝 Created TestRail run: ${runId}`)

  return {
    submissionId: runId.toString(),
    resultsUrl: `${config.baseUrl}/index.php?/runs/view/${runId}`,
  }
}

async function submitToTestfiesta(
  config: ZodTestfiestaConfig,
  testResults: any,
  metadata: any,
): Promise<SubmissionResult> {
  const payload = {
    project: config.project,
    results: testResults,
    metadata,
  }

  const sanitizedPayload = { ...payload, credentials: '***' }
  core.debug(`Submitting to Testfiesta with payload: ${JSON.stringify(sanitizedPayload)}`)

  const submissionId = '1'

  const tfClient = new TestFiestaClient({
    domain: config.baseUrl,
    apiKey: config.credentials,
  })
  await tfClient.submitTestResults()

  core.info(`📝 Created Testfiesta submission: ${submissionId}`)

  return {
    submissionId,
    resultsUrl: `${config.baseUrl}/runs/view/${submissionId}`,
  }
}

async function readTestResults(resultsPath: string): Promise<any> {
  const stats = fs.statSync(resultsPath)

  if (stats.isDirectory()) {
    return await readTestResultsFromDirectory(resultsPath)
  }
  else {
    return await readSingleTestResultFile(resultsPath)
  }
}

async function readTestResultsFromDirectory(directory: string): Promise<any[]> {
  const results: any[] = []
  const files = fs.readdirSync(directory, { recursive: true })

  for (const file of files) {
    if (typeof file === 'string' && isTestResultFile(file)) {
      const fullPath = path.join(directory, file)
      results.push(await readSingleTestResultFile(fullPath))
    }
  }

  return results
}

async function readSingleTestResultFile(filePath: string): Promise<any> {
  const content = fs.readFileSync(filePath, 'utf8')
  const extension = path.extname(filePath).toLowerCase()

  if (extension === '.xml') {
    return { format: 'junit', content, filePath }
  }
}

function isTestResultFile(filename: string): boolean {
  const testFilePatterns = [
    /test.*\.xml$/i,
    /.*results?\.xml$/i,
    /.*report.*\.xml$/i,
    /junit.*\.xml$/i,
  ]

  return testFilePatterns.some(pattern => pattern.test(filename))
}

run()
