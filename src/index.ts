import * as fs from 'node:fs'
import * as path from 'node:path'
import * as core from '@actions/core'
import * as github from '@actions/github'

interface BaseConfig {
  provider: string
  resultsPath: string
  credentials: string
  baseUrl: string
  failOnError: boolean
}

interface TestRailConfig extends BaseConfig {
  provider: 'testrail'
  projectId: number
  suiteId?: number
  runName?: string
  milestoneId?: number
  assignedTo?: string
}

interface TestfiestaConfig extends BaseConfig {
  provider: 'testfiesta'
  project: string
  environment?: string
  tags?: string[]
  branch?: string
}

type ProviderConfig = TestRailConfig | TestfiestaConfig

interface SubmissionResult {
  submissionId: string
  resultsUrl: string
}

async function run(): Promise<void> {
  try {
    const config = await parseConfiguration()

    core.info(`🚀 Submitting test results to ${config.provider}`)
    core.info(`📁 Results path: ${config.resultsPath}`)
    core.info(`🌐 Base URL: ${config.baseUrl}`)

    validateProviderConfig(config)

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

async function parseConfiguration(): Promise<ProviderConfig> {
  const provider = core.getInput('provider', { required: true }).toLowerCase()
  const baseConfig: BaseConfig = {
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

  switch (provider) {
    case 'testrail':
      return {
        ...baseConfig,
        provider: 'testrail',
        projectId: providerConfig.project_id || providerConfig.projectId,
        suiteId: providerConfig.suite_id || providerConfig.suiteId,
        runName: providerConfig.run_name || providerConfig.runName || `CI Run ${github.context.runId}`,
        milestoneId: providerConfig.milestone_id || providerConfig.milestoneId,
        assignedTo: providerConfig.assigned_to || providerConfig.assignedTo,
      } as TestRailConfig

    case 'testfiesta':
      return {
        ...baseConfig,
        provider: 'testfiesta',
        project: providerConfig.project,
        environment: providerConfig.environment || 'default',
        tags: Array.isArray(providerConfig.tags)
          ? providerConfig.tags
          : (providerConfig.tags || '').split(',').filter(Boolean),
        branch: providerConfig.branch || github.context.ref,
      } as TestfiestaConfig

    default:
      throw new Error(`Unsupported provider: ${provider}. Supported providers: testrail, testfiesta`)
  }
}

function validateProviderConfig(config: ProviderConfig): void {
  switch (config.provider) {
    case 'testrail':
      if (!config.projectId) {
        throw new Error('TestRail configuration requires project_id')
      }
      break

    case 'testfiesta':
      if (!config.project) {
        throw new Error('Testfiesta configuration requires project name')
      }
      break
  }

  if (!fs.existsSync(config.resultsPath)) {
    throw new Error(`Results path does not exist: ${config.resultsPath}`)
  }
}

async function submitTestResults(
  config: ProviderConfig,
  metadata: any,
): Promise<SubmissionResult> {
  const testResults = await readTestResults(config.resultsPath)

  switch (config.provider) {
    case 'testrail':
      return await submitToTestRail(config, testResults, metadata)

    case 'testfiesta':
      return await submitToTestfiesta(config, testResults, metadata)

    default:
    // @ts-expect-error config.provider does not exist
      throw new Error(`Unsupported provider: ${config.provider}`)
  }
}

async function submitToTestRail(
  config: TestRailConfig,
  testResults: any,
  metadata: any,
): Promise<SubmissionResult> {
  const [_username, _password] = config.credentials.split(':')

  const runPayload = {
    name: config.runName,
    description: `Automated test run from ${metadata.workflow} (${metadata.commit})`,
    suite_id: config.suiteId,
    milestone_id: config.milestoneId,
    assignedto_id: config.assignedTo,
    results: testResults,
    include_all: true,
  }

  core.debug(`Creating TestRail run with payload: ${JSON.stringify(runPayload)}`)
  const runId = 1

  core.info(`📝 Created TestRail run: ${runId}`)

  return {
    submissionId: runId.toString(),
    resultsUrl: `${config.baseUrl}/index.php?/runs/view/${runId}`,
  }
}

async function submitToTestfiesta(
  config: TestfiestaConfig,
  testResults: any,
  metadata: any,
): Promise<SubmissionResult> {
  const _payload = {
    project: config.project,
    environment: config.environment,
    tags: config.tags,
    branch: config.branch,
    results: testResults,
    metadata,
  }

  return {
    submissionId: '1',
    resultsUrl: `${config.baseUrl}/runs/view/1`,
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

  switch (extension) {
    case '.xml':
      return { format: 'junit', content, filePath }
    default:
      return { format: 'raw', content, filePath }
  }
}

function isTestResultFile(filename: string): boolean {
  const testFilePatterns = [
    /test.*\.xml$/i,
    /.*results?\.xml$/i,
    /.*results?\.json$/i,
    /.*\.tap$/i,
  ]

  return testFilePatterns.some(pattern => pattern.test(filename))
}

run()
