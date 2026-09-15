// Shared type definitions, referenced from JSDoc throughout src/.

/**
 * Repository identity.
 * @typedef {object} RepoTarget
 * @property {string} owner
 * @property {string} repo
 * @property {'github' | 'bitbucket'} [provider]
 */

/**
 * A single scan finding as returned by the scanrepo.dev API.
 * Note: the API exposes no line number, and `filePath` is empty for
 * repository-level findings.
 * @typedef {object} Finding
 * @property {string} [ruleId]
 * @property {string} [title]
 * @property {string} [description]
 * @property {'critical' | 'warning' | 'info'} [severity]
 * @property {string} [category]
 * @property {number} [points]
 * @property {string} [filePath]
 * @property {string} [snippet]
 */

/**
 * A raw scan report as returned by the scanrepo.dev API.
 * @typedef {object} RepoReport
 * @property {string} [riskLevel]
 * @property {number} [riskScore]
 * @property {Finding[]} [findings]
 * @property {object[]} [categories]
 * @property {boolean} [incomplete]
 * @property {number} [filesScanned]
 * @property {number} [totalRepoFiles]
 * @property {number} [coverage]
 * @property {string} [commitSha]
 * @property {string} [ref]
 * @property {string} [scannedAt]
 * @property {{owner?: string, repo?: string, provider?: string}} [meta]
 */

/**
 * A finding reduced to display fields.
 * @typedef {object} FindingView
 * @property {string} ruleId
 * @property {string} title
 * @property {string} description
 * @property {string} severity
 * @property {string} filePath
 * @property {string} location
 * @property {string} snippet
 */

/**
 * The tooltip view model produced by buildViewModel.
 * @typedef {object} ViewModel
 * @property {string} verdict
 * @property {number | null} score
 * @property {string} summary
 * @property {FindingView[]} findings
 * @property {number} totalFindings
 * @property {string | null} url
 * @property {number | null} coverage
 * @property {boolean} incomplete
 * @property {string} commitSha
 * @property {string} [ref]
 * @property {string} repoFullName
 * @property {string} [scannedAt]
 * @property {string} disclaimer
 * @property {string} [errorMessage]
 * @property {boolean} [pending]
 */

export {};