// TODO #22198
import { REPOSITORY_CHANGED } from '../../../../constants/error-messages.ts';
import { logger } from '../../../../logger/index.ts';
import type { Pr } from '../../../../modules/platform/index.ts';
import { platform } from '../../../../modules/platform/index.ts';
import { coerceArray } from '../../../../util/array.ts';
import { getFile } from '../../../../util/git/index.ts';
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

/**
 * Detect whether a previously merged update is still present on the base branch.
 *
 * `prAlreadyExisted()` matches on `state: '!open'`, so a merged PR counts even when
 * its update was reverted afterwards. Reading the base branch tells the two apart.
 * Every file the update touches must still be readable and still contain one of the
 * update's target strings.
 */
// ponytail: substring match, so a short range like "2.1" can match "2.1.3". Replace with
// the manager's updateArtifacts output if this heuristic ever misfires.
export async function isUpdatePresentOnBaseBranch(
  config: BranchConfig,
): Promise<boolean> {
  const filePaths = new Set<string>();
  const targets = new Set<string>();

  for (const upgrade of config.upgrades) {
    for (const filePath of [
      upgrade.packageFile,
      upgrade.lockFile,
      ...coerceArray(upgrade.lockFiles),
    ]) {
      if (filePath) {
        filePaths.add(filePath);
      }
    }
    for (const target of [upgrade.newValue, upgrade.newDigest]) {
      if (target) {
        targets.add(target);
      }
    }
  }

  for (const filePath of filePaths) {
    const content = await getFile(filePath, config.baseBranch);
    if (!content || ![...targets].some((target) => content.includes(target))) {
      return false;
    }
  }

  return filePaths.size > 0;
}
