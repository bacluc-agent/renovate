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
    const baseCommit = fakeSha('base');
    const prCommit = fakeSha('pr');
    const config = partial<BranchConfig>({
      baseBranch: 'base-branch',
    });

    beforeEach(() => {
      git.getBranchCommit.mockReturnValue(baseCommit);
      git.getBranchFilesFromCommit.mockResolvedValue(['package.json']);
      git.diffCommitTree.mockResolvedValue([]);
    });

    it('returns true when the merged update is still present', async () => {
      await expect(
        mergedUpdateStillPresent(config, partial<Pr>({ sha: prCommit })),
      ).resolves.toBe(true);
    });

    it('returns false when a merged update file drifted from base', async () => {
      git.diffCommitTree.mockResolvedValueOnce([
        partial<DiffTreeItem>({ path: 'package.json' }),
      ]);

      await expect(
        mergedUpdateStillPresent(config, partial<Pr>({ sha: prCommit })),
      ).resolves.toBe(false);
    });

    it('returns true when only an unrelated file drifted from base', async () => {
      git.diffCommitTree.mockResolvedValueOnce([
        partial<DiffTreeItem>({ path: 'README.md' }),
      ]);

      await expect(
        mergedUpdateStillPresent(config, partial<Pr>({ sha: prCommit })),
      ).resolves.toBe(true);
    });

    it('returns true when the PR commit must be resolved from its source branch', async () => {
      git.getBranchCommit
        .mockReturnValueOnce(prCommit)
        .mockReturnValueOnce(baseCommit);

      await expect(
        mergedUpdateStillPresent(
          config,
          partial<Pr>({ sourceBranch: 'renovate/update' }),
        ),
      ).resolves.toBe(true);
    });

    it.each([
      ['the PR commit is unavailable', { commit: null }],
      ['the PR file list is unavailable', { files: null }],
      ['the PR file list is empty', { files: [] }],
      ['the base commit is unavailable', { base: null }],
    ])('fails closed when %s', async (_description, values) => {
      if ('commit' in values) {
        git.getBranchCommit.mockReturnValue(null);
      }
      if ('files' in values) {
        git.getBranchFilesFromCommit.mockResolvedValue(values.files);
      }
      if ('base' in values) {
        git.getBranchCommit
          .mockReturnValueOnce(prCommit)
          .mockReturnValueOnce(null);
      }

      await expect(
        mergedUpdateStillPresent(
          config,
          partial<Pr>({ sourceBranch: 'renovate/update' }),
        ),
      ).resolves.toBe(true);
    });

    it('fails closed when comparing commits errors', async () => {
      git.diffCommitTree.mockRejectedValueOnce(new Error('git failed'));

      await expect(
        mergedUpdateStillPresent(config, partial<Pr>({ sha: prCommit })),
      ).resolves.toBe(true);
    });
  });
});
