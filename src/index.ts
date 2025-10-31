import type { ZodProviderConfig, ZodTestfiestaConfig, ZodTestRailConfig } from './config'
import * as core from '@actions/core'
import * as github from '@actions/github'
import { JunitXmlParser, TestFiestaClient, TestRailClient } from '@testfiesta/tacotruck'
import { parseConfiguration, validateProviderConfig } from './config'
import { readTestResult } from './utils'

interface SubmissionResult {
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

    core.setOutput('results-url', result.resultsUrl)

    core.info(`✅ Test results submitted successfully!`)
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

async function submitTestResults(
  config: ZodProviderConfig,
  metadata: any,
): Promise<SubmissionResult> {
  const testResult = await readTestResult(config.resultsPath)

  if (!testResult) {
    core.setFailed(`No test results found in ${config.resultsPath}`)
    return { resultsUrl: '' }
  }

  const parsedResult = new JunitXmlParser().fromFile(testResult.filePath).build()

  switch (config.provider) {
    case 'testrail':
      return await submitToTestRail(config, parsedResult, metadata)

    case 'testfiesta':
      return await submitToTestfiesta(config, testResult.filePath, metadata)

    default:
      throw new Error(`Unsupported provider`)
  }
}

async function submitToTestRail(
  config: ZodTestRailConfig,
  testResults: any,
  metadata: any,
): Promise<SubmissionResult> {
  const runPayload = {
    name: config.runName,
    description: `Automated test run from ${metadata.workflow} (${metadata.commit})`,
    results: testResults,
    include_all: true,
    source: config.source,
  }

  const sanitizedPayload = { ...runPayload, credentials: '***' }
  core.debug(`Creating TestRail run with payload: ${JSON.stringify(sanitizedPayload)}`)

  const runId = 1

  const trClient = new TestRailClient({
    baseUrl: config.baseUrl || '',
    apiKey: config.credentials,
  })

  const options: Record<string, string> = {}
  if (config.source) {
    options.source = config.source
  }
  await trClient.submitTestResults(testResults, options, config.runName)

  return {
    resultsUrl: `${config.baseUrl}/index.php?/runs/view/${runId}`,
  }
}

async function submitToTestfiesta(
  config: ZodTestfiestaConfig,
  resultsPath: string,
  metadata: any,
): Promise<SubmissionResult> {
  const payload = {
    provider: config.provider,
    resultsPath: config.resultsPath,
    runName: config.runName,
    baseUrl: config.baseUrl,
    project: config.project,
    handle: config.handle,
    source: config.source,
    metadata,
  }

  const sanitizedPayload = { ...payload, credentials: '***' }
  core.debug(`Submitting to Testfiesta with payload: ${JSON.stringify(sanitizedPayload)}`)

  const tfClient = new TestFiestaClient({
    baseUrl: config.baseUrl,
    apiKey: config.credentials,
    organizationHandle: config.handle,
  })

  const options: { runName: string, source?: string } = { runName: config.runName }
  if (config.source) {
    options.source = config.source
  }

  await tfClient.submitTestResults(config.project, resultsPath, options)

  return {
    resultsUrl: `${config.baseUrl}/${config.handle}/${config.project}/runs`,
  }
}

run()
