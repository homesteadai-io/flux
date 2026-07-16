import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const stagingRoot = join(root, 'dist-mcpb');
const releaseDir = join(root, 'release');
const outputPath = join(releaseDir, 'Flux.mcpb');
const tscPath = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const mcpbCliPath = join(root, 'node_modules', '@anthropic-ai', 'mcpb', 'dist', 'cli', 'cli.js');

function run(command, args, options = {}) {
  const completed = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    ...options,
  });

  if (completed.error) {
    throw completed.error;
  }
  if (completed.status !== 0) {
    throw new Error(`${command} exited with status ${completed.status ?? 'unknown'}.`);
  }
}

function listTypeScriptFiles(directory) {
  if (!existsSync(directory)) {
    throw new Error(`Required source directory is missing: ${relative(root, directory)}`);
  }

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      return listTypeScriptFiles(entryPath);
    }
    return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
      ? [entryPath]
      : [];
  });
}

function installProductionDependencies(stagingDir) {
  cpSync(join(root, 'package.json'), join(stagingDir, 'package.json'));
  cpSync(join(root, 'package-lock.json'), join(stagingDir, 'package-lock.json'));

  const npmArgs = ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'];
  if (process.platform === 'win32') {
    const command = process.env.ComSpec ?? 'cmd.exe';
    run(command, ['/d', '/s', '/c', 'npm.cmd', ...npmArgs], { cwd: stagingDir });
    return;
  }

  run('npm', npmArgs, { cwd: stagingDir });
}

mkdirSync(stagingRoot, { recursive: true });
mkdirSync(releaseDir, { recursive: true });

const stagingDir = mkdtempSync(join(stagingRoot, 'stage-'));

try {
  const sourceFiles = ['mcp', 'shared', 'server'].flatMap((directory) =>
    listTypeScriptFiles(join(root, directory)),
  );

  if (sourceFiles.length === 0) {
    throw new Error('No MCP runtime TypeScript files were found.');
  }
  if (!existsSync(tscPath) || !existsSync(mcpbCliPath)) {
    throw new Error('Install repository dependencies before building the MCPB.');
  }

  run(process.execPath, [
    tscPath,
    '--target',
    'ES2022',
    '--module',
    'NodeNext',
    '--moduleResolution',
    'NodeNext',
    '--strict',
    '--esModuleInterop',
    '--skipLibCheck',
    '--types',
    'node',
    '--rootDir',
    root,
    '--outDir',
    stagingDir,
    '--sourceMap',
    'false',
    '--declaration',
    'false',
    ...sourceFiles,
  ]);

  mkdirSync(join(stagingDir, 'scripts'), { recursive: true });
  cpSync(join(root, 'scripts', 'transcript.cjs'), join(stagingDir, 'scripts', 'transcript.cjs'));
  cpSync(join(root, 'mcpb', 'manifest.json'), join(stagingDir, 'manifest.json'));
  cpSync(join(root, 'mcpb', 'README.md'), join(stagingDir, 'README.md'));

  installProductionDependencies(stagingDir);

  const stagedPackage = JSON.parse(readFileSync(join(stagingDir, 'package.json'), 'utf8'));
  stagedPackage.private = true;
  stagedPackage.type = 'module';
  delete stagedPackage.scripts;
  delete stagedPackage.devDependencies;
  writeFileSync(join(stagingDir, 'package.json'), `${JSON.stringify(stagedPackage, null, 2)}\n`);

  run(process.execPath, [mcpbCliPath, 'validate', join(stagingDir, 'manifest.json')]);
  rmSync(outputPath, { force: true });
  run(process.execPath, [mcpbCliPath, 'pack', stagingDir, outputPath]);

  process.stdout.write(`Built ${relative(root, outputPath).split(sep).join('/')}\n`);
} finally {
  rmSync(stagingDir, { recursive: true, force: true });
}
