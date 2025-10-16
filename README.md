# TacoTruck Action

Submit test results from any language/framework to test management services like Testfiesta, TestRail, and more.

## Quick Start

```yaml
- name: Submit Test Results
  uses: testfiesta/tacotruck-action@v1
  with:
    provider: testrail
    handle: <your-username>
    project: <your-project-id>
    results-path: ./test-results.xml
    credentials: ${{ secrets.TESTRAIL_CREDENTIALS }}
    base-url: 'https://<your-username>.testrail.io'
    run-name: 'CI Run #${{ github.run_number }}'
    source: GitHub Actions
```

## Supported Providers

### TestRail

TestRail uses Basic Authentication with username and password.

#### Setup

1. **Create TestRail API credentials:**
   - Go to your TestRail instance → Administration → Site Settings → API
   - Enable the API
   - Note your username and password (or create an API-specific user)

2. **Add to GitHub Secrets:**

   ```
   TESTRAIL_CREDENTIALS = "your-username:your-password"
   ```

   > **⚠️ IMPORTANT: CREDENTIALS FORMAT**
   >
   > **Must use the format:** `username:password`
   >
   > ✅ **Correct format:** `myuser:mypassword`
   > ❌ **Wrong format:** Base64 encoded key or API key only
   >
   > The action automatically handles Base64 encoding for TestRail authentication.

#### Usage

```yaml
- name: Submit to TestRail
  uses: testfiesta/tacotruck-action@v1
  with:
    provider: testrail
    handle: <your-username>
    project: <your-project-id>
    results-path: ./junit-results.xml
    credentials: ${{ secrets.TESTRAIL_CREDENTIALS }}
    base-url: 'https://<your-username>.testrail.io'
    run-name: 'CI Run #${{ github.run_number }}'
    source: GitHub Actions
```

### Testfiesta

Testfiesta uses Bearer token authentication.

#### Setup

1. **Get your API token:**
   - Go to Testfiesta dashboard → Settings → API Tokens
   - Generate a new token

2. **Add to GitHub Secrets:**
   ```
   TESTFIESTA_API_KEY = "your-api-key"
   ```

#### Usage

```yaml
- name: Submit to Testfiesta
  uses: testfiesta/tacotruck-action@v1
  with:
    provider: testfiesta
    handle: <your-org-handle>
    project: <your-project-key>
    results-path: ./test-results
    credentials: ${{ secrets.TESTFIESTA_API_KEY }}
    base-url: 'https://api.testfiesta.com'
    run-name: 'CI Run #${{ github.run_number }}'
    source: GitHub Actions
```

## Input Reference

| Input           | Required | Description                                                                    |
| --------------- | -------- | ------------------------------------------------------------------------------ |
| `provider`      | ✅       | Provider name (`testrail`, `testfiesta`)                                       |
| `handle`        | ✅       | Handle of the provider (e.g. username for testrail, org handle for testfiesta) |
| `project`       | ✅       | Project id or key of the provider                                              |
| `results-path`  | ✅       | Path to test results file or directory                                         |
| `credentials`   | ✅       | Authentication credentials (format varies by provider)                         |
| `base-url`      | ✅       | Base URL for the provider's API                                                |
| `run-name`      | ❌       | Name of the test run                                                           |
| `source`        | ❌       | Source of the test run (e.g. 'GitHub Actions', 'Jenkins')                      |
| `fail-on-error` | ❌       | Fail workflow if submission fails (default: `true`)                            |

## Output Reference

| Output          | Description                       |
| --------------- | --------------------------------- |
| `submission-id` | ID of the submitted test results  |
| `results-url`   | URL to view the submitted results |

## Supported Test Result Formats

- **JUnit XML** (`.xml`) - Most common format

The action automatically detects the format based on file extension and content.

## Advanced Examples

### Multiple Test Result Files

```yaml
- name: Submit All Test Results
  uses: testfiesta/tacotruck-action@v1
  with:
    provider: testrail
    handle: <your_username>
    project: <your-project-key>
    results-path: ./test-results # Directory with multiple result files
    credentials: ${{ secrets.TESTRAIL_CREDENTIALS }}
    base-url: 'https://yourcompany.testrail.io'
    run-name: 'Full Test Suite - ${{ github.sha }}'
    source: GitHub Actions
```

### Conditional Submission

```yaml
- name: Submit Test Results
  if: always() # Run even if tests failed
  uses: testfiesta/tacotruck-action@v1
  with:
    provider: testrail
    handle: <your_username>
    project: <your-project-id>
    results-path: ./test-results.xml
    credentials: ${{ secrets.TESTRAIL_CREDENTIALS }}
    base-url: 'https://yourcompany.testrail.io'
    fail-on-error: false # Don't fail the workflow if submission fails
    run-name: '${{ github.workflow }} - ${{ github.ref_name }} #${{ github.run_number }}'
    source: GitHub Actions
```

### Using Outputs

```yaml
- name: Submit Test Results
  id: submit-results
  uses: testfiesta/tacotruck-action@v1
  with:
    provider: testfiesta
    handle: <your-org-handle>
    project: <your-project-key>
    results-path: ./test-results.json
    credentials: ${{ secrets.TESTFIESTA_API_KEY }}
    base-url: 'https://api.testfiesta.com'
    source: GitHub Actions

- name: Comment PR with Results
  if: github.event_name == 'pull_request'
  uses: actions/github-script@v7
  with:
    script: |
      github.rest.issues.createComment({
        issue_number: context.issue.number,
        owner: context.repo.owner,
        repo: context.repo.repo,
        body: `🧪 Test results submitted! View at: ${{ steps.submit-results.outputs.results-url }}`
      })
```

## Troubleshooting

### TestRail Issues

**Authentication Error (401):**

- Verify your credentials format: `username:password`
- Ensure the user has API access enabled
- Check that the TestRail API is enabled in Site Settings

**Project/Suite Not Found (400/404):**

- Verify `project_id` and `suite_id` exist in your TestRail instance
- Ensure the user has access to the specified project

### General Issues

**No test results found:**

- Check the `results-path` points to the correct file/directory
- Verify test results are in a supported format (JUnit XML)

**Submission failed:**

- Check the `base-url` is correct and accessible
- Verify network connectivity from GitHub Actions to your service
- Enable debug logging by setting `ACTIONS_STEP_DEBUG: true`

## License

MIT
