'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

class ExtensionInstaller {
  constructor(envManager, logCollector) {
    this.envManager = envManager;
    this.logCollector = logCollector;
  }

  /**
   * Installs the newly built extension into the isolated extensions directory.
   */
  async install(buildResult) {
    this.logCollector.info('ExtensionInstaller', 'Installing newly built extension into isolated environment...');

    const extensionsDir = this.envManager.extensionsDir;
    const publisher = 'antigravity-dev';
    const extName = buildResult.extensionName || 'antigravity-models';
    const version = buildResult.version || '0.5.20';
    const extensionId = `${publisher}.${extName}`;
    const targetFolder = path.join(extensionsDir, `${extensionId}-${version}`);

    // If VSIX is available and code CLI exists, test code --install-extension
    let cliInstallSucceeded = false;
    if (buildResult.vsixPath && fs.existsSync(buildResult.vsixPath)) {
      try {
        this.logCollector.info('ExtensionInstaller', `Attempting CLI install of VSIX: ${path.basename(buildResult.vsixPath)}`);
        const res = spawnSync('code.cmd', [
          '--extensions-dir', `"${extensionsDir}"`,
          '--install-extension', `"${buildResult.vsixPath}"`,
          '--force'
        ], { encoding: 'utf8', shell: true });

        if (res.status === 0) {
          cliInstallSucceeded = true;
          this.logCollector.info('ExtensionInstaller', `CLI installation successful.`);
        } else {
          this.logCollector.warn('ExtensionInstaller', `code CLI install exited with ${res.status}: ${res.stderr || res.stdout}`);
        }
      } catch (err) {
        this.logCollector.warn('ExtensionInstaller', `code CLI install attempt skipped: ${err.message}`);
      }
    }

    // Direct filesystem unpack verification to ensure isolated integrity
    if (!fs.existsSync(targetFolder)) {
      this.logCollector.info('ExtensionInstaller', `Deploying extension package structure to isolated directory: ${targetFolder}`);
      fs.mkdirSync(targetFolder, { recursive: true });

      const rootDir = process.cwd();
      // Copy package.json
      fs.copyFileSync(path.join(rootDir, 'package.json'), path.join(targetFolder, 'package.json'));

      // Copy out/ directory
      const copyDir = (src, dst) => {
        if (!fs.existsSync(src)) return;
        fs.mkdirSync(dst, { recursive: true });
        for (const item of fs.readdirSync(src)) {
          const srcItem = path.join(src, item);
          const dstItem = path.join(dst, item);
          if (fs.statSync(srcItem).isDirectory()) {
            copyDir(srcItem, dstItem);
          } else {
            fs.copyFileSync(srcItem, dstItem);
          }
        }
      };

      copyDir(path.join(rootDir, 'out'), path.join(targetFolder, 'out'));

      // Copy catalog if present
      if (fs.existsSync(path.join(rootDir, 'catalog'))) {
        copyDir(path.join(rootDir, 'catalog'), path.join(targetFolder, 'catalog'));
      }
    }

    // 4. Verification: Verify installation files
    const installedPkgJson = path.join(targetFolder, 'package.json');
    const installedMain = path.join(targetFolder, 'out', 'src', 'extension.js');

    if (!fs.existsSync(installedPkgJson)) {
      const err = `Installation verification failed: package.json missing in ${targetFolder}`;
      this.logCollector.critical('ExtensionInstaller', err);
      return { success: false, error: err };
    }

    if (!fs.existsSync(installedMain)) {
      const err = `Installation verification failed: entry point missing at ${installedMain}`;
      this.logCollector.critical('ExtensionInstaller', err);
      return { success: false, error: err };
    }

    const manifest = JSON.parse(fs.readFileSync(installedPkgJson, 'utf8'));
    this.logCollector.info(
      'ExtensionInstaller',
      `Extension installation verified: ${extensionId} v${manifest.version} in ${targetFolder}`
    );

    return {
      success: true,
      extensionId,
      installedPath: targetFolder,
      mainFile: installedMain,
      manifest: manifest
    };
  }
}

module.exports = { ExtensionInstaller };
