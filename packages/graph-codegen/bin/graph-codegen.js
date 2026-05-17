#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';

import { generateGraphIdentitySurface, generateGraphModel, parseJsonGraphSpecV1 } from '../dist/index.js';

function printHelp() {
  // Keep help text minimal; errors should still be actionable.
  console.log(
    `graph-codegen\n\nUsage:\n  graph-codegen <input.json> --out <output.ts>\n\nOptions:\n  --out, -o   Output TypeScript file path\n  --format    Output format: model | identity (default: model)\n  --help      Show help\n`,
  );
}

function parseArgs(argv) {
  const args = [...argv];
  if (args.includes('--help')) {
    return { help: true };
  }

  const inputPath = args.shift();
  if (!inputPath) {
    throw new Error(
      'Missing input path. Example: graph-codegen ./graph.json --out ./graph.types.ts',
    );
  }

  let outPath;
  let format = 'model';
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--out' || arg === '-o') {
      outPath = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--format') {
      format = args[i + 1] ?? format;
      i += 1;
    }
  }

  if (!outPath) {
    throw new Error(
      'Missing --out <path>. Example: graph-codegen ./graph.json --out ./graph.types.ts',
    );
  }

  if (format !== 'model' && format !== 'identity') {
    throw new Error(`Unsupported --format '${format}'. Expected 'model' or 'identity'.`);
  }

  return { inputPath, outPath, format };
}

async function main() {
  try {
    const parsed = parseArgs(process.argv.slice(2));
    if (parsed.help) {
      printHelp();
      return;
    }

    const jsonText = await readFile(parsed.inputPath, 'utf8');
    const jsonValue = JSON.parse(jsonText);
    const spec = parseJsonGraphSpecV1(jsonValue);
    const out =
      parsed.format === 'identity'
        ? generateGraphIdentitySurface(spec)
        : generateGraphModel(spec);
    await writeFile(parsed.outPath, out, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exitCode = 1;
  }
}

void main();
