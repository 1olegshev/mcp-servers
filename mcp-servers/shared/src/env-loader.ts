/**
 * Shared environment loading utilities for MCP servers
 * Centralizes the common pattern of loading .env files relative to the project root
 */

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

/**
 * Options for loading environment variables
 */
export interface EnvLoaderOptions {
  /** Custom path to .env file (overrides default resolution) */
  envPath?: string;
  /** Whether to throw an error if .env file is not found (default: false) */
  required?: boolean;
  /** Additional environment variables to set (useful for testing) */
  overrides?: Record<string, string>;
}

/**
 * Get the directory name from an import.meta.url
 * This is the ESM equivalent of __dirname
 */
export function getDirname(importMetaUrl: string): string {
  const __filename = fileURLToPath(importMetaUrl);
  return path.dirname(__filename);
}

/**
 * Find the project root by looking for package.json or .env file
 */
export function findProjectRoot(startDir: string): string {
  let currentDir = startDir;

  // Walk up the directory tree looking for markers
  while (currentDir !== path.dirname(currentDir)) {
    // Check for .env file (our primary marker)
    if (fs.existsSync(path.join(currentDir, '.env'))) {
      return currentDir;
    }
    // Also check for a root-level package.json with workspaces
    const pkgPath = path.join(currentDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.workspaces || pkg.name === 'mcp-servers-workspace') {
          return currentDir;
        }
      } catch {
        // Ignore parse errors
      }
    }
    currentDir = path.dirname(currentDir);
  }

  // Fallback: assume we're 3 levels deep (mcp-servers/*/src/)
  return path.resolve(startDir, '../../..');
}

/**
 * Load environment variables from .env file
 * Uses the same pattern as all MCP servers but centralized
 *
 * @param importMetaUrl - Pass import.meta.url from the calling module
 * @param options - Optional configuration
 * @returns The resolved path to the .env file (or null if not found)
 *
 * @example
 * ```typescript
 * import { loadEnv } from '@mcp-servers/shared';
 *
 * // In your server entry point:
 * loadEnv(import.meta.url);
 * ```
 */
export function loadEnv(importMetaUrl: string, options: EnvLoaderOptions = {}): string | null {
  const dirname = getDirname(importMetaUrl);

  // Determine the .env file path
  let envPath: string;
  if (options.envPath) {
    envPath = options.envPath;
  } else {
    const projectRoot = findProjectRoot(dirname);
    envPath = path.resolve(projectRoot, '.env');
  }

  // Check if file exists
  if (!fs.existsSync(envPath)) {
    if (options.required) {
      throw new Error(`Required .env file not found at: ${envPath}`);
    }
    return null;
  }

  // Load the environment variables
  dotenv.config({ path: envPath });

  // Apply any overrides
  if (options.overrides) {
    for (const [key, value] of Object.entries(options.overrides)) {
      process.env[key] = value;
    }
  }

  return envPath;
}

/**
 * Load environment variables manually (without dotenv)
 * Useful for cases where dotenv shouldn't be used (like release-coordinator)
 *
 * @param envPath - Path to the .env file
 * @returns Record of loaded environment variables
 */
export function loadEnvManually(envPath: string): Record<string, string> {
  if (!fs.existsSync(envPath)) {
    return {};
  }

  const envContent = fs.readFileSync(envPath, 'utf8');
  const envLines = envContent.split('\n');
  const loaded: Record<string, string> = {};

  for (const line of envLines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').replace(/^["']|["']$/g, '');
        process.env[key.trim()] = value.trim();
        loaded[key.trim()] = value.trim();
      }
    }
  }

  return loaded;
}

/**
 * Get required environment variable or throw
 *
 * @param name - Environment variable name
 * @param defaultValue - Optional default value if not set
 * @returns The environment variable value
 * @throws Error if variable is not set and no default provided
 */
export function getEnvOrThrow(name: string, defaultValue?: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value.trim().replace(/\r\n?/g, '');
}

/**
 * Get optional environment variable with default
 *
 * @param name - Environment variable name
 * @param defaultValue - Default value if not set
 * @returns The environment variable value or default
 */
export function getEnv(name: string, defaultValue: string = ''): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    return defaultValue;
  }
  return value.trim().replace(/\r\n?/g, '');
}
