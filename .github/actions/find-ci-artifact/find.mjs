/**
 * The ID of the newest run of this repository, not a fork, that has an unexpired artifact with
 * this name and either passed or has a passing producer job; null when there is none.
 * @param {any} github an Octokit client, as actions/github-script provides
 * @param {{ owner: string, repo: string }} repository
 * @param {string} name
 * @param {string} producer
 * @returns {Promise<number | null>}
 */
export async function findArtifactRun(github, { owner, repo }, name, producer) {
  const pages = github.paginate.iterator(github.rest.actions.listArtifactsForRepo, {
    owner,
    repo,
    name,
    per_page: 100,
  });
  for await (const { data: artifacts } of pages) {
    for (const { expired, workflow_run: run } of artifacts) {
      if (expired || !run || run.head_repository_id !== run.repository_id) continue;
      const { data } = await github.rest.actions.getWorkflowRun({ owner, repo, run_id: run.id });
      if (data.conclusion === "success") return run.id;
      const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRun, {
        owner,
        repo,
        run_id: run.id,
        per_page: 100,
      });
      if (jobs.some((job) => job.name === producer && job.conclusion === "success")) return run.id;
    }
  }
  return null;
}
