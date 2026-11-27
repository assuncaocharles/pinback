/** Identifies the pull request (and the commit) a preview deployment was built from. */
export interface PRContext {
  owner: string;
  repo: string;
  prNumber: number;
  commitSha: string;
}
