import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run through npm run release:verify');
const run = (args, cwd = root) => {
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 120000 });
  if (result.status !== 0) throw new Error(`${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
};
const release = resolve(root, 'release'); mkdirSync(release, { recursive: true });
run([npmCli, 'run', 'build']);
const [packed] = JSON.parse(run([npmCli, 'pack', '--ignore-scripts', '--json', '--pack-destination', release]));
if (packed.files.some(f => /(?:ledger\.db|config\.yaml$|site-runtime|test\/|node_modules|\.env)/.test(f.path) && f.path !== 'spendguard.config.yaml')) throw new Error('Unexpected private/runtime content in package');
const sandbox = resolve(root, '.spendguard/release-verification', String(Date.now())); mkdirSync(sandbox, { recursive: true });
writeFileSync(resolve(sandbox, 'package.json'), JSON.stringify({ name: 'release-verification', private: true, type: 'module' }));
const archive = resolve(release, packed.filename);
const offline = process.argv.includes('--offline');
run([npmCli, 'install', offline ? '--offline' : '--prefer-offline', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', archive], sandbox);
const cli = resolve(sandbox, 'node_modules/spend-guard/dist/packages/report-cli/src/cli.js');
if (!existsSync(cli)) throw new Error('Published CLI missing');
const demo = JSON.parse(run([cli, 'demo', '--json'], sandbox));
if (!demo.simulation || demo.report.allowed !== 2 || demo.report.blocked !== 3 || demo.report.blockedUsd !== 3.5 || !demo.verification.valid) throw new Error('Packaged demo failed');
run([cli, 'verify', '--ledger', demo.ledgerPath], sandbox);
run([cli, 'init', '--repo', '.'], sandbox);
const doctor = spawnSync(process.execPath, [cli, 'doctor', '--json'], { cwd: sandbox, encoding: 'utf8' });
if (doctor.status !== 1 || !JSON.parse(doctor.stdout).some(c => c.status === 'fail' && c.name === 'Tool prices')) throw new Error('Doctor did not reject starter prices');
run([cli, 'init', '--sandbox', '--config', 'sandbox.yaml', '--repo', '.'], sandbox);
run([cli, 'doctor', '--config', 'sandbox.yaml', '--json'], sandbox);
const registration=JSON.parse(run([cli,'mcp-config','--config','sandbox.yaml','--approval','browser'],sandbox));
if(!registration.mcpServers['spend-guard'].args.includes('browser'))throw new Error('Browser approval registration missing');
run([cli,'recover','--ledger',demo.ledgerPath,'--json'],sandbox);
const result = { version: packed.version, archive, integrity: packed.integrity, packageFileCount: packed.files.length,
  cleanInstall: true, offlineInstall: offline, packagedDemo: true, ledgerVerification: true, safeInitialization: true, doctorRejectsUnconfiguredProvider: true,
  sandboxSetup: true, browserApprovalRegistration: true, recoveryCommand: true };
writeFileSync(resolve(release, 'verification.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
