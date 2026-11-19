import { fakeSha, git, partial, platform } from '~test/util.ts';
import { logger } from '../../../../logger/index.ts';
import type { Pr } from '../../../../modules/platform/index.ts';
import type { DiffTreeItem } from '../../../../util/git/types.ts';
import type { BranchConfig } from '../../../types.ts';
import {
  mergedUpdateStillPresent,
  prAlreadyExisted,
} from './check-existing.ts';

describe('workers/repository/update/branch/check-existing', () => {
  describe('prAlreadyExisted', () => {
    let config: BranchConfig;

    beforeEach(() => {
      config = {
        baseBranch: 'base-branch',
        manager: 'some-manager',
        upgrades: [],
        branchName: 'some-branch',
        prTitle: 'some-title',
      } satisfies BranchConfig;
    });

    it('returns false if recreating closed PRs', async () => {
      config.recreateClosed = true;
      await expect(prAlreadyExisted(config)).resolves.toBeNull();
      expect(platform.findPr).toHaveBeenCalledTimes(0);
    });

    it('returns false if check misses', async () => {
      config.recreateClosed = false;
      await expect(prAlreadyExisted(config)).resolves.toBeNull();
      expect(platform.findPr).toHaveBeenCalledTimes(1);
    });

    it('returns true if first check hits', async () => {
      platform.findPr.mockResolvedValueOnce(partial<Pr>({ number: 12 }));
      platform.getPr.mockResolvedValueOnce(
        partial<Pr>({
          number: 12,
          state: 'closed',
        }),
      );
      await expect(prAlreadyExisted(config)).resolves.toEqual({ number: 12 });
      expect(platform.findPr).toHaveBeenCalledTimes(1);
    });

    it('returns true if second check hits', async () => {
      config.branchPrefixOld = 'deps/';
      platform.findPr.mockResolvedValueOnce(null);
      platform.findPr.mockResolvedValueOnce(partial<Pr>({ number: 12 }));
      platform.getPr.mockResolvedValueOnce(
        partial<Pr>({
          number: 12,
          state: 'closed',
        }),
      );
      await expect(prAlreadyExisted(config)).resolves.toEqual({ number: 12 });
      expect(platform.findPr).toHaveBeenCalledTimes(2);

      expect(logger.debug).toHaveBeenCalledWith(
        `Found closed PR with current title`,
      );
    });

    it('returns null if the branchPrefixOld check also misses', async () => {
      config.branchPrefixOld = 'deps/';
      platform.findPr.mockResolvedValue(null);

      await expect(prAlreadyExisted(config)).resolves.toBeNull();

      expect(platform.findPr).toHaveBeenCalledTimes(2);
      expect(logger.debug).not.toHaveBeenCalledWith(
        'Found closed PR with branchPrefixOld',
      );
    });
  });

  describe('mergedUpdateStillPresent', () => {
    let config: BranchConfig;
    let pr: Pr;

    const failClosedLog =
      'Unable to check whether merged PR #13 is still present in base-branch - assuming it is';
    const negativeLog =
      'Matching PR #13 was merged previously, but its changes are no longer in base-branch - treating it as a new update';

    beforeEach(() => {
      config = {
        baseBranch: 'base-branch',
        manager: 'some-manager',
        upgrades: [],
        branchName: 'some-branch',
        prTitle: 'some-title',
      } satisfies BranchConfig;
      pr = partial<Pr>({
        number: 13,
        sourceBranch: 'some-branch',
        sha: fakeSha('pr-sha'),
      });
      git.getBranchCommit.mockReturnValue(fakeSha('base-sha'));
      git.getBranchFilesFromCommit.mockResolvedValue(['package.json']);
      git.diffCommitTree.mockResolvedValue([]);
    });

    it('returns true when the merged changes are still present', async () => {
      await expect(mergedUpdateStillPresent(config, pr)).resolves.toBe(true);
    });

    it('returns false when the merged files changed in the base branch', async () => {
      git.diffCommitTree.mockResolvedValueOnce([
        partial<DiffTreeItem>({ path: 'package.json' }),
      ]);

      await expect(mergedUpdateStillPresent(config, pr)).resolves.toBe(false);
      expect(logger.debug).toHaveBeenCalledWith(negativeLog);
    });

    it('returns true when only unrelated files changed in the base branch', async () => {
      git.diffCommitTree.mockResolvedValueOnce([
        partial<DiffTreeItem>({ path: 'README.md' }),
      ]);

      await expect(mergedUpdateStillPresent(config, pr)).resolves.toBe(true);
    });

    it('fails closed when the PR commit cannot be resolved', async () => {
      pr.sha = undefined;
      git.getBranchCommit.mockReturnValueOnce(null);

      await expect(mergedUpdateStillPresent(config, pr)).resolves.toBe(true);
      expect(git.getBranchCommit).toHaveBeenCalledWith(pr.sourceBranch);
      expect(logger.debug).toHaveBeenCalledWith(failClosedLog);
    });

    it('fails closed when the PR commit has no file list', async () => {
      git.getBranchFilesFromCommit.mockResolvedValueOnce(null);

      await expect(mergedUpdateStillPresent(config, pr)).resolves.toBe(true);
      expect(logger.debug).toHaveBeenCalledWith(failClosedLog);
    });

    it('fails closed when the PR commit has an empty file list', async () => {
      git.getBranchFilesFromCommit.mockResolvedValueOnce([]);

      await expect(mergedUpdateStillPresent(config, pr)).resolves.toBe(true);
      expect(logger.debug).toHaveBeenCalledWith(failClosedLog);
    });

    it('fails closed when the base commit cannot be resolved', async () => {
      git.getBranchCommit.mockReturnValueOnce(null);

      await expect(mergedUpdateStillPresent(config, pr)).resolves.toBe(true);
      expect(logger.debug).toHaveBeenCalledWith(failClosedLog);
    });

    it('fails closed when diffing the commit tree throws', async () => {
      git.diffCommitTree.mockRejectedValueOnce(new Error('git failed'));

      await expect(mergedUpdateStillPresent(config, pr)).resolves.toBe(true);
      expect(logger.debug).toHaveBeenCalledWith(
        { prNumber: 13, err: expect.any(Error) },
        failClosedLog,
      );
    });

    it('resolves the PR commit from the source branch when sha is missing', async () => {
      pr.sha = undefined;
      git.getBranchCommit
        .mockReturnValueOnce(fakeSha('pr-sha'))
        .mockReturnValueOnce(fakeSha('base-sha'));

      await expect(mergedUpdateStillPresent(config, pr)).resolves.toBe(true);
      expect(git.getBranchCommit).toHaveBeenNthCalledWith(1, pr.sourceBranch);
      expect(git.getBranchCommit).toHaveBeenNthCalledWith(2, config.baseBranch);
    });
  });
});
