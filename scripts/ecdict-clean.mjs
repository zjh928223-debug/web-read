#!/usr/bin/env node

import { lstatSync, rmSync } from 'node:fs';
import { isAbsolute, parse, resolve } from 'node:path';

const configuredPath = process.env.ECDICT_DATABASE_PATH;
if (!configuredPath) {
  throw new Error('ECDICT_DATABASE_PATH is required; refusing to guess a deletion target.');
}

const target = resolve(configuredPath);
const root = parse(target).root;
if (!isAbsolute(target) || target === root || lstatSync(target).isDirectory()) {
  throw new Error(`Refusing unsafe ECDICT deletion target: ${target}`);
}

rmSync(target);
process.stdout.write(`Deleted ECDICT database: ${target}\n`);
