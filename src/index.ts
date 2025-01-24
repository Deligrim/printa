#!/usr/bin/env node
import rc from 'rc';
import { Command } from 'commander';
import { readdir, readFile, lstat } from 'fs/promises';
import { join, basename, extname, relative, resolve } from 'path';
import chalk, { ChalkInstance } from 'chalk';
import { highlight } from 'cli-highlight';
import { isText } from 'istextorbinary'

interface Entry {
  name: string;
  isDirectory: boolean;
  isSymlink: boolean;
  children?: Entry[];
  ignored?: boolean;
}

interface Config {
  fileExtensions?: string | string[];
  ignore?: string | string[];
  depth?: number;
  color?: boolean;
  structureOnly?: boolean;
  contentsOnly?: boolean;
  colors?: {
    directory?: string;
    file?: string;
    symlink?: string;
    content?: string;
    [key: string]: string | undefined;
  };
  symbols?: {
    vertical?: string;
    branch?: string;
    end?: string;
    space?: string;
  };
}

const program = new Command();
const defaultConfig: Config = {
  fileExtensions: undefined,
  ignore: ['node_modules', 'build', 'package-lock.json'],
  depth: 10,
  color: true,
  colors: {
    directory: 'blue',
    file: 'yellow',
    symlink: 'cyan',
    content: 'gray'
  },
  symbols: {
    vertical: '│',
    branch: '├──',
    end: '└──',
    space: '    '
  }
};

program
  .name('printa')
  .description('CLI utility to list project structure and file contents')
  .version('1.0.5')
  .argument('<project>', 'Path to the project folder')
  .option('-f, --file-extensions <extensions>', 'Comma-separated list of file extensions or names to include content')
  .option('-i, --ignore <patterns>', 'Comma-separated list of folders/files to ignore')
  .option('-d, --depth <number>', 'Recursive search depth')
  .option('--no-color', 'Disable color output')
  .option('--structure-only', 'Show only directory structure')
  .option('--contents-only', 'Show only file contents')
  .parse(process.argv);

async function main() {
  try {
    const cliOptions = program.opts();
    const rcConfig = rc('listcode', defaultConfig) as Config;

    const config: Config = {
      ...defaultConfig,
      ...rcConfig,
      ...cliOptions,
      colors: {
        ...defaultConfig.colors,
        ...rcConfig.colors,
        ...cliOptions.colors
      },
      symbols: {
        ...defaultConfig.symbols,
        ...rcConfig.symbols,
        ...cliOptions.symbols
      }
    };

    const projectPath = resolve(program.args[0]);
    const fileExtensions = config.fileExtensions
      ? (Array.isArray(config.fileExtensions) ? config.fileExtensions : config.fileExtensions.split(','))
      : null;

    const ignoreList = Array.isArray(config.ignore)
      ? config.ignore
      : (config.ignore || '').split(',');

    const maxDepth = config.depth || 10;

    const getColor = (colorName: string, defaultColor: keyof ChalkInstance = 'yellow'): ChalkInstance => {
      if (!config.color) return chalk;
      const colorKey = (config.colors?.[colorName] || defaultColor) as keyof ChalkInstance;
      return (chalk[colorKey] || chalk[defaultColor]) as unknown as ChalkInstance;
    };

    const structure = await traverseDirectory(projectPath, 0, maxDepth, ignoreList);

    if (!config.contentsOnly) {
      console.log(getColor('directory')(`Structure of ${projectPath}:`));
      printStructure(structure, [], config, getColor);
    }

    if (!config.structureOnly) {
      const allFiles = collectFiles(structure, projectPath);
      const filesToInclude = allFiles.filter(file => shouldIncludeFile(file, fileExtensions));

      console.log(getColor('content')('\nContent of files:'));
      for (const file of filesToInclude) {
        await printFileContents(file, projectPath, config, getColor);
      }
    }
  } catch (error) {
    console.error(chalk.redBright('Error:'), error instanceof Error ? error.message : 'Unknown error');
    if (error instanceof Error && error.stack) {
      console.error(chalk.gray(error.stack));
    }
    process.exit(1);
  }
}

async function traverseDirectory(
  dirPath: string,
  currentDepth: number,
  maxDepth: number,
  ignoreList: string[]
): Promise<Entry[]> {
  if (currentDepth > maxDepth) return [];

  try {
    const entries = await readdir(dirPath);
    const processedEntries: Entry[] = [];

    for (const entryName of entries) {
      const entryPath = join(dirPath, entryName);
      const entryStat = await lstat(entryPath);
      const isSymlink = entryStat.isSymbolicLink();
      const isDirectory = entryStat.isDirectory();

      if (ignoreList.includes(entryName) || (isDirectory && entryName.startsWith('.'))) {
        processedEntries.push({
          name: entryName,
          isDirectory,
          isSymlink,
          ignored: true
        });
        continue;
      }

      if (isSymlink) {
        processedEntries.push({
          name: `${entryName} →`,
          isDirectory: false,
          isSymlink: true
        });
        continue;
      }

      if (isDirectory) {
        const children = await traverseDirectory(entryPath, currentDepth + 1, maxDepth, ignoreList);
        processedEntries.push({
          name: entryName,
          isDirectory: true,
          isSymlink: false,
          children
        });
      } else {
        processedEntries.push({
          name: entryName,
          isDirectory: false,
          isSymlink: false
        });
      }
    }

    return processedEntries.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.error(chalk.yellow(`Warning: Skipping ${dirPath} - ${error instanceof Error ? error.message : 'Unknown error'}`));
    return [];
  }
}

function printStructure(
  entries: Entry[],
  prefixes: string[],
  config: Config,
  getColor: (colorName: string, defaultColor?: keyof ChalkInstance) => ChalkInstance
) {
  const lastIndex = entries.length - 1;
  entries.forEach((entry, index) => {
    const isLast = index === lastIndex;
    const connector = isLast ? config.symbols?.end ?? '└──' : config.symbols?.branch ?? '├──';
    const currentPrefix = prefixes.join('');

    let entryName = entry.name;
    if (entry.isDirectory) {
      entryName = getColor('directory')(entryName + '/');
    } else if (entry.isSymlink) {
      entryName = getColor('symlink')(entryName);
    } else {
      const ext = extname(entry.name);
      entryName = getColor(ext, 'green')(entryName);
    }

    console.log(`${currentPrefix}${connector} ${entryName}`);

    if (entry.children) {
      const newPrefixes = [...prefixes];
      newPrefixes.push(isLast ? config.symbols?.space ?? '    ' : `${config.symbols?.vertical ?? '│'}   `);
      printStructure(entry.children, newPrefixes, config, getColor);
    }
  });
}

function collectFiles(entries: Entry[], basePath: string): string[] {
  return entries.filter(entry => !entry.ignored).flatMap(entry => {
    const entryPath = join(basePath, entry.name.split(' →')[0]);
    if (entry.isDirectory && entry.children) {
      return collectFiles(entry.children, entryPath);
    }
    return [entryPath];
  });
}

function shouldIncludeFile(filePath: string, fileExtensions: string[] | null): boolean {
  if (!fileExtensions) return true;

  const filename = basename(filePath);
  const ext = extname(filename);
  const baseName = filename.slice(0, -ext.length) || filename;

  return fileExtensions.some(pattern => {
    if (pattern.startsWith('.')) return ext === pattern;
    return filename === pattern || baseName === pattern;
  });
}

async function printFileContents(
  filePath: string,
  basePath: string,
  config: Config,
  getColor: (colorName: string, defaultColor?: keyof ChalkInstance) => ChalkInstance
) {
  try {
    const fileBuffer = await readFile(filePath);
    if (!isText(filePath, fileBuffer)) return;
    const content = fileBuffer.toString('utf-8');
    const relativePath = relative(basePath, filePath);
    const ext = extname(filePath);
    const color = getColor(ext, 'gray');

    let highlightedContent = content;
    if (config.color) {
      try {
        highlightedContent = highlight(content);
      } catch {
        highlightedContent = color(content);
      }
    } else {
      highlightedContent = content;
    }

    console.log(color(`\n./${relativePath}:`));
    console.log(highlightedContent);
  } catch (error) {
    console.error(chalk.yellow(`\nWarning: Could not read ${filePath} - ${error instanceof Error ? error.message : 'Unknown error'}`));
  }
}

main();