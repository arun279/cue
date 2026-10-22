import { readFileSync } from "node:fs";
import { repositoryPath } from "./repository-path";

const getJobsBlock = (workflowPath: string): string => {
  const workflow = readFileSync(workflowPath, "utf8");

  // This intentionally parses only the top-level jobs block and its
  // two-space-indented job IDs, not general YAML.
  const matches = [
    ...workflow.matchAll(/^jobs:[ \t]*\r?\n([\s\S]*?)(?=^[^ \t\r\n#][^:\r\n]*:|(?![\s\S]))/gm),
  ];
  const jobsBlock = matches.length === 1 ? matches[0]?.[1] : undefined;
  if (jobsBlock === undefined) {
    throw new Error(`expected one jobs block, found ${matches.length}`);
  }
  return jobsBlock;
};

export type CiJob = {
  name: string;
  body: string;
};

/**
 * A step that runs a local composite action with no inputs, replaced by that
 * action's own steps at the job's step indent, so a test reads what the job runs.
 */
const LOCAL_ACTION = /^ {6}- uses: \.\/(\.github\/actions\/[\w-]+)\n(?! {8}with:)/gm;

const inlineActions = (body: string): string =>
  body.replace(LOCAL_ACTION, (_, directory: string) => {
    const action = readFileSync(repositoryPath(directory, "action.yml"), "utf8");
    return action
      .slice(action.indexOf("  steps:\n") + "  steps:\n".length)
      .replace(/^(?=.)/gm, "  ");
  });

export const readWorkflowJobs = (
  workflowPath: string,
  { withActions = false }: { withActions?: boolean } = {},
): CiJob[] => {
  const jobsBlock = getJobsBlock(workflowPath);
  const headers = [...jobsBlock.matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(?:#.*)?\r?$/gm)];
  return headers.map((header, index) => {
    const body = jobsBlock.slice(
      (header.index ?? 0) + header[0].length,
      headers[index + 1]?.index ?? jobsBlock.length,
    );
    return { name: header[1] as string, body: withActions ? inlineActions(body) : body };
  });
};
