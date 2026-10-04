'use strict';

const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

class BuildManager {
  constructor(config, logCollector) {
    this.config = config;
    this.logCollector = logCollector;
    this.rootDir = config.rootDir || process.cwd();
  }

  /**
   * Compiles and packages the extension.
   * Halts with structured error report if compilation fails.
   */
  async build() {
    const startTime = Date.now();
    this.logCollector.info('BuildManager', 'Starting extension build & compilation...');

    // 1. Run TypeScript compilation
    try {
      this.logCollector.info('BuildManager', 'Executing TypeScript compiler: tsc -p ./');
      const tscResult = spawnSync('npx', ['tsc', '-p', './'], {
        cwd: this.rootDir,
        encoding: 'utf8',
        shell: true
      });

      if (tscResult.status !== 0) {
        const errorMsg = tscResult.stderr || tscResult.stdout || 'TypeScript compilation failed.';
        this.logCollector.critical('BuildManager', `Compilation error: ${errorMsg}`);
        return {
          success: false,
          stage: 'compile',
          error: errorMsg,
          durationMs: Date.now() - startTime
        };
      }
      this.logCollector.info('BuildManager', 'TypeScript compilation completed successfully.');
    } catch (err) {
      this.logCollector.critical('BuildManager', `Exception during compilation: ${err.message}`);
      return {
        success: false,
        stage: 'compile',
        error: err.message,
        durationMs: Date.now() - startTime
      };
    }

    // 2. Verify compiled output directory
    const outDir = path.join(this.rootDir, 'out', 'src');
    if (!fs.existsSync(outDir) || !fs.existsSync(path.join(outDir, 'extension.js'))) {
      const errorMsg = `Expected compilation target ${outDir}/extension.js not found.`;
      this.logCollector.critical('BuildManager', errorMsg);
      return {
        success: false,
        stage: 'verification',
        error: errorMsg,
        durationMs: Date.now() - startTime
      };
    }

    // 3. Check / generate VSIX package
    let vsixPath = null;
    const pkgJson = JSON.parse(fs.readFileSync(path.join(this.rootDir, 'package.json'), 'utf8'));
    const expectedVsixName = `${pkgJson.name}-${pkgJson.version}.vsix`;
    const rootVsix = path.join(this.rootDir, expectedVsixName);

    if (fs.existsSync(rootVsix)) {
      vsixPath = rootVsix;
      this.logCollector.info('BuildManager', `Located existing VSIX package: ${expectedVsixName} (${(fs.statSync(rootVsix).size / 1024 / 1024).toFixed(2)} MB)`);
    } else {
      this.logCollector.info('BuildManager', `Packaging VSIX using vsce...`);
      try {
        const vsceResult = spawnSync('npx', ['vsce', 'package', '--no-git-tag-version', '--no-update-package-json'], {
          cwd: this.rootDir,
          encoding: 'utf8',
          shell: true
        });
        if (vsceResult.status === 0 && fs.existsSync(rootVsix)) {
          vsixPath = rootVsix;
          this.logCollector.info('BuildManager', `Generated VSIX package: ${expectedVsixName}`);
        } else {
          this.logCollector.warn('BuildManager', `vsce warning/skipped: ${vsceResult.stderr || vsceResult.stdout}`);
        }
      } catch (err) {
        this.logCollector.warn('BuildManager', `vsce packaging skipped: ${err.message}`);
      }
    }

    return {
      success: true,
      stage: 'completed',
      vsixPath: vsixPath,
      outDir: outDir,
      version: pkgJson.version,
      extensionName: pkgJson.name,
      displayName: pkgJson.displayName,
      durationMs: Date.now() - startTime
    };
  }
}

module.exports = { BuildManager };
