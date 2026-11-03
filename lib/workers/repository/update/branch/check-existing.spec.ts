import { fakeSha, git, partial, platform } from '~test/util.ts';
import { logger } from '../../../../logger/index.ts';
import type { Pr } from '../../../../modules/platform/index.ts';
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
    const prCommit = fakeSha('pr');
    const baseCommit = fakeSha('base');

    beforeEach(() => {
      config = {
        baseBranch: 'base-branch',
        manager: 'some-manager',
        upgrades: [],
        branchName: 'some-branch',
        prTitle: 'some-title',
        branchCommits: { 'base-branch': baseCommit },
      } satisfies BranchConfig;
      git.getBranchCommit.mockReturnValue(baseCommit);
      git.getBranchFilesFromCommit.mockResolvedValue(['package.json']);
      git.diffCommitTree.mockResolvedValue([]);
    });

    it('returns true when the PR changes are still present', async () => {
      const pr = partial<Pr>({
        number: 12,
        sourceBranch: 'renovate/test',
        sha: prCommit,
      });

      await expect(mergedUpdateStillPresent(config, pr)).resolves.toBe(true);
      expect(git.diffCommitTree).toHaveBeenCalledExactlyOnceWith(
        baseCommit,
        prCommit,
      );
    });

    it('returns false when a PR file changed on the base branch', async () => {
      const pr = partial<Pr>({
        number: 12,
        sourceBranch: 'renovate/test',
        sha: prCommit,
      });
      git.diffCommitTree.mockResolvedValueOnce([
        { path: 'package.json', mode: '100644', type: 'blob', sha: prCommit },
      ]);

      await expect(mergedUpdateStillPresent(config, pr)).resolves.toBe(false);
      expect(logger.debug).toHaveBeenCalledWith(
        `Matching PR #12 was merged previously, but its changes are no longer in base-branch - treating it as a new update`,
      );
    });

    it('returns true when only an unrelated path changed', async () => {
      const pr = partial<Pr>({
        number: 12,
        sourceBranch: 'renovate/test',
        sha: prCommit,
      });
      git.diffCommitTree.mockResolvedValueOnce([
        { path: 'README.md', mode: '100644', type: 'blob', sha: prCommit },
      ]);

      await expect(mergedUpdateStillPresent(config, pr)).resolves.toBe(true);
    });

    it('fails closed when the PR and branch commit are unavailable', async () => {
      const pr = partial<Pr>({ number: 12, sourceBranch: 'renovate/test' });
      git.getBranchCommit.mockReturnValue(null);

      await expect(mergedUpdateStillPresent(config, pr)).resolves.toBe(true);
      expect(logger.debug).toHaveBeenCalledWith(
        `Unable to check whether merged PR #12 is still present in base-branch - assuming it is`,
      );
    });

    it('fails closed when the PR files cannot be determined', async () => {
      const pr = partial<Pr>({
        number: 12,
        sourceBranch: 'renovate/test',
        sha: prCommit,
      });
      git.getBranchFilesFromCommit.mockResolvedValueOnce(null);

      await expect(mergedUpdateStillPresent(config, pr)).resolves.toBe(true);
    });

    it('fails closed when the PR has no changed files', async () => {
      const pr = partial<Pr>({
        number: 12,
        sourceBranch: 'renovate/test',
        sha: prCommit,
      });
      git.getBranchFilesFromCommit.mockResolvedValueOnce([]);

      await expect(mergedUpdateStillPresent(config, pr)).resolves.toBe(true);
    });

    it('fails closed when the base branch commit is unavailable', async () => {
      const pr = partial<Pr>({
        number: 12,
        sourceBranch: 'renovate/test',
        sha: prCommit,
      });
      git.getBranchCommit.mockReturnValueOnce(null);

      await expect(mergedUpdateStillPresent(config, pr)).resolves.toBe(true);
    });

    it('fails closed when comparing commits fails', async () => {
      const pr = partial<Pr>({
        number: 12,
        sourceBranch: 'renovate/test',
        sha: prCommit,
      });
      git.diffCommitTree.mockRejectedValueOnce(new Error('git failed'));

      await expect(mergedUpdateStillPresent(config, pr)).resolves.toBe(true);
      expect(logger.debug).toHaveBeenCalledWith(
        { prNumber: 12, err: expect.any(Error) },
        `Unable to check whether merged PR #12 is still present in base-branch - assuming it is`,
      );
    });

    it('uses the source branch commit when the PR SHA is missing', async () => {
      const pr = partial<Pr>({ number: 12, sourceBranch: 'renovate/test' });
      git.getBranchCommit.mockReturnValueOnce(prCommit);

      await expect(mergedUpdateStillPresent(config, pr)).resolves.toBe(true);
      expect(git.getBranchFilesFromCommit).toHaveBeenCalledExactlyOnceWith(
        prCommit,
      );
    });
  });
});
