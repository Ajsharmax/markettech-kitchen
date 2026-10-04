/**
 * End-to-end test for the bulk product importer (Admin → Products → Import Products).
 *
 * Runs the real Pages Function (functions/api/[[path]].js) against a real SQLite
 * database with a small Cloudflare D1 shim, using .xlsx and .csv uploads built
 * inside this file. Nothing here talks to the network.
 *
 * Requires Node 22.5+ (node:sqlite). Run with: npm run test:import
 */

import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import process from 'node:process';

const BASE_URL = 'https://store.example.com';
const failures = [];
let checks = 0;
