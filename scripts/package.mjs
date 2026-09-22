import { buildPackage } from './release.mjs';

try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--out')) throw new Error('用法：pnpm package [--out <新 ZIP 路径>]');
  console.log(`发布包：${await buildPackage(args[1])}`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
