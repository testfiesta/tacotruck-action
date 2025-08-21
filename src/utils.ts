import * as fs from 'node:fs'
import * as path from 'node:path'

export async function readTestResult(resultsPath: string) {
  return await readSingleTestResultFile(resultsPath)
}

export async function readSingleTestResultFile(filePath: string) {
  const content = fs.readFileSync(filePath, 'utf8')
  const extension = path.extname(filePath).toLowerCase()

  if (extension === '.xml') {
    return { format: 'junit', content, filePath }
  }
}

export function isTestResultFile(filename: string): boolean {
  const testFilePatterns = [
    /test.*\.xml$/i,
    /.*results?\.xml$/i,
    /.*report.*\.xml$/i,
    /junit.*\.xml$/i,
  ]

  return testFilePatterns.some(pattern => pattern.test(filename))
}
