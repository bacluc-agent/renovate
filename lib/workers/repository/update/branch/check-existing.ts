// TODO #22198
import { REPOSITORY_CHANGED } from '../../../../constants/error-messages.ts';
import { logger } from '../../../../logger/index.ts';
import type { Pr } from '../../../../modules/platform/index.ts';
import { platform } from '../../../../modules/platform/index.ts';
import {
  diffCommitTree,
  getBranchCommit,
  getBranchFilesFromCommit,
} from '../../../../util/git/index.ts';
import type { BranchConfig } from '../../../types.ts';

export async function prAlreadyExisted(
  config: BranchConfig,
): Promise<Pr | null> {
  logger.trace({ config }, 'prAlreadyExisted');
  if (config.recreateClosed) {
    logger.debug('recreateClosed is true. No need to check for closed PR.');
    return null;
  }
  logger.debug(
    'Check for closed PR because recreating closed PRs is disabled.',
  );
  // Return if same PR already existed
  let pr = await platform.findPr({
    branchName: config.branchName,
    prTitle: config.prTitle,
    state: '!open',
    targetBranch: config.baseBranch,
  });

  if (!pr && config.branchPrefix !== config.branchPrefixOld) {
    pr = await platform.findPr({
      branchName: config.branchName.replace(
        config.branchPrefix!,
        config.branchPrefixOld!,
      ),
      prTitle: config.prTitle,
      state: '!open',
      targetBranch: config.baseBranch,
    });
    if (pr) {
      logger.debug('Found closed PR with branchPrefixOld');
    }
  }

  if (pr) {
    logger.debug('Found closed PR with current title');
    const prDetails = await platform.getPr(pr.number);
    // istanbul ignore if
    if (prDetails!.state === 'open') {
      logger.debug('PR reopened - aborting run');
      throw new Error(REPOSITORY_CHANGED);
    }
    return pr;
  }
  logger.debug('prAlreadyExisted=false');
  return null;
}

export async function mergedUpdateStillPresent(
  config: BranchConfig,
  pr: Pr,
): Promise<boolean> {
  try {
    const prCommit = pr.sha ?? getBranchCommit(pr.sourceBranch);
    if (!prCommit) {
      logger.debug(
        `Unable to check whether merged PR #${pr.number} is still present in ${config.baseBranch} - assuming it is`,
      );
      return true;
    }

    const files = await getBranchFilesFromCommit(prCommit);
    if (!files?.length) {
      logger.debug(
        `Unable to check whether merged PR #${pr.number} is still present in ${config.baseBranch} - assuming it is`,
      );
      return true;
    }

    const baseCommit = getBranchCommit(config.baseBranch);
    if (!baseCommit) {
      logger.debug(
        `Unable to check whether merged PR #${pr.number} is still present in ${config.baseBranch} - assuming it is`,
      );
      return true;
    }

    const drift = await diffCommitTree(baseCommit, prCommit);
    const stillPresent = !files.some((file) =>
      drift.some((change) => change.path === file),
    );
    if (!stillPresent) {
      logger.debug(
        `Matching PR #${pr.number} was merged previously, but its changes are no longer in ${config.baseBranch} - treating it as a new update`,
      );
    }
    return stillPresent;
  } catch (err) {
    logger.debug(
      { prNumber: pr.number, err },
      `Unable to check whether merged PR #${pr.number} is still present in ${config.baseBranch} - assuming it is`,
    );
    return true;
  }
}
