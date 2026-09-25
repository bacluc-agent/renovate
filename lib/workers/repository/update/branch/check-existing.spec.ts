import { codeBlock } from 'common-tags';
import { git, partial, platform } from '~test/util.ts';
import { logger } from '../../../../logger/index.ts';
import type { Pr } from '../../../../modules/platform/index.ts';
import type { BranchConfig, BranchUpgradeConfig } from '../../../types.ts';
import {
  isUpdatePresentOnBaseBranch,
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

    it('returns previously merged matching PR after base revert', async () => {
      platform.findPr.mockResolvedValueOnce(partial<Pr>({ number: 12 }));
      platform.getPr.mockResolvedValueOnce(
        partial<Pr>({
          number: 12,
          state: 'merged',
        }),
      );
      await expect(prAlreadyExisted(config)).resolves.toEqual({ number: 12 });
      expect(platform.findPr).toHaveBeenCalledWith({
        branchName: 'some-branch',
        prTitle: 'some-title',
        state: '!open',
        targetBranch: 'base-branch',
      });
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

  describe('isUpdatePresentOnBaseBranch', () => {
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

    it('returns true when the new value is still on the base branch', async () => {
      config.upgrades = partial<BranchUpgradeConfig>([
        { packageFile: 'package.json', newValue: '2.1.3' },
      ]);
      git.getFile.mockResolvedValueOnce(codeBlock`{ "ms": "2.1.3" }`);

      await expect(isUpdatePresentOnBaseBranch(config)).resolves.toBe(true);
      expect(git.getFile).toHaveBeenCalledExactlyOnceWith(
        'package.json',
        'base-branch',
      );
    });

    it('returns false when the merged update was reverted from the base branch', async () => {
      config.upgrades = partial<BranchUpgradeConfig>([
        { packageFile: 'package.json', newValue: '2.1.3' },
      ]);
      git.getFile.mockResolvedValueOnce(codeBlock`{ "ms": "2.1.2" }`);

      await expect(isUpdatePresentOnBaseBranch(config)).resolves.toBe(false);
    });

    it('returns false when the base branch file cannot be read', async () => {
      config.upgrades = partial<BranchUpgradeConfig>([
        { packageFile: 'package.json', newValue: '2.1.3' },
      ]);
      git.getFile.mockResolvedValueOnce(null);

      await expect(isUpdatePresentOnBaseBranch(config)).resolves.toBe(false);
    });

    it('returns true when the new digest is still on the base branch', async () => {
      config.upgrades = partial<BranchUpgradeConfig>([
        { packageFile: 'Dockerfile', newDigest: 'sha256:abcdef' },
      ]);
      git.getFile.mockResolvedValueOnce('FROM node:24@sha256:abcdef');

      await expect(isUpdatePresentOnBaseBranch(config)).resolves.toBe(true);
      expect(git.getFile).toHaveBeenCalledExactlyOnceWith(
        'Dockerfile',
        'base-branch',
      );
    });

    it('returns true for a lockfile update whose lockfile still pins the new version', async () => {
      config.upgrades = partial<BranchUpgradeConfig>([
        {
          packageFile: 'package.json',
          lockFile: 'pnpm-lock.yaml',
          lockFiles: ['nested/package-lock.json'],
          newValue: '2.1.3',
          isLockfileUpdate: true,
        },
      ]);
      git.getFile.mockResolvedValue('  ms@2.1.3:');

      await expect(isUpdatePresentOnBaseBranch(config)).resolves.toBe(true);
      expect(git.getFile).toHaveBeenCalledTimes(3);
    });

    it('returns false for a lockfile update whose lockfile was reverted on the base branch', async () => {
      config.upgrades = partial<BranchUpgradeConfig>([
        {
          packageFile: 'package.json',
          lockFile: 'pnpm-lock.yaml',
          newValue: '2.1.3',
          isLockfileUpdate: true,
        },
      ]);
      git.getFile.mockResolvedValueOnce(codeBlock`{ "ms": "2.1.3" }`);
      git.getFile.mockResolvedValueOnce('  ms@2.1.2:');

      await expect(isUpdatePresentOnBaseBranch(config)).resolves.toBe(false);
    });

    it('reads each file only once for a multi-upgrade group', async () => {
      config.upgrades = partial<BranchUpgradeConfig>([
        {
          packageFile: 'package.json',
          lockFile: 'pnpm-lock.yaml',
          newValue: '2.1.3',
        },
        {
          packageFile: 'package.json',
          lockFile: 'pnpm-lock.yaml',
          newValue: '2.1.4',
        },
      ]);
      git.getFile.mockResolvedValue('  ms@2.1.3:');

      await expect(isUpdatePresentOnBaseBranch(config)).resolves.toBe(true);
      expect(git.getFile).toHaveBeenCalledTimes(2);
    });

    it('returns false when the update has no file to read', async () => {
      config.upgrades = partial<BranchUpgradeConfig>([{ newValue: '2.1.3' }]);

      await expect(isUpdatePresentOnBaseBranch(config)).resolves.toBe(false);
      expect(git.getFile).not.toHaveBeenCalled();
    });

    it('returns false when the update has no new value or digest', async () => {
      config.upgrades = partial<BranchUpgradeConfig>([
        { packageFile: 'package.json' },
      ]);
      git.getFile.mockResolvedValueOnce(codeBlock`{ "ms": "2.1.3" }`);

      await expect(isUpdatePresentOnBaseBranch(config)).resolves.toBe(false);
    });
  });
});
