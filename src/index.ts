import rc from "rc";
import { Command } from "commander";
import { readdir, readFile, lstat } from "fs/promises";
import { join, basename, relative, resolve, sep, extname } from "path";
import chalk, { ChalkInstance } from "chalk";
import { highlight } from "cli-highlight";
import { isText } from "istextorbinary";
import ignore, { Ignore } from "ignore";

interface Entry {
  name: string;
  isDirectory: boolean;
  isSymlink: boolean;
  children?: Entry[];
  ignored?: boolean;
}

interface Config {
  extensions?: string[];
  ignore?: string[];
  depth?: number;
  color?: boolean;
  structureOnly?: boolean;
  contentsOnly?: boolean;
  gitignore?: boolean;
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
  extensions: [],
  ignore: ["node_modules/", "build/", "package-lock.json", ".git"],
  depth: 10,
  color: true,
  gitignore: true,
  colors: {
    directory: "blue",
    file: "yellow",
    symlink: "cyan",
    content: "gray",
  },
  symbols: {
    vertical: "│",
    branch: "├──",
    end: "└──",
    space: "    ",
  },
};

program
  .name("printa")
  .description("CLI utility to list project structure and file contents")
  .version("1.0.6")
  .argument("<project>", "Path to the project folder")
  .option(
    "-e, --extensions <extensions>",
    "Comma-separated list of file extensions to include (ts,js etc)",
  )
  .option(
    "-i, --ignore <patterns>",
    "Comma-separated list of glob patterns to ignore files/directories",
  )
  .option("-d, --depth <number>", "Recursive search depth")
  .option("--no-color", "Disable color output")
  .option("--no-gitignore", "Disable reading .gitignore file")
  .option("--structure-only", "Show only directory structure")
  .option("--contents-only", "Show only file contents")
  .parse(process.argv);

async function main() {
  try {
    const cliOptions = program.opts();
    const rcConfig = rc("listcode", defaultConfig) as Config;

    const config: Config = {
      ...defaultConfig,
      ...rcConfig,
      ...cliOptions,
      colors: {
        ...defaultConfig.colors,
        ...rcConfig.colors,
        ...cliOptions.colors,
      },
      symbols: {
        ...defaultConfig.symbols,
        ...rcConfig.symbols,
        ...cliOptions.symbols,
      },
      ignore: [
        ...(defaultConfig.ignore || []),
        ...(rcConfig.ignore || []),
        ...(cliOptions.ignore ? cliOptions.ignore.split(",") : []),
      ],
      extensions: [
        ...(defaultConfig.extensions || []),
        ...(rcConfig.extensions || []),
        ...(cliOptions.extensions ? cliOptions.extensions.split(",") : []),
      ],
    };

    const projectPath = resolve(program.args[0]);

    let gitignorePatterns: string[] = [];
    if (config.gitignore) {
      gitignorePatterns = await readGitignore(projectPath);
    }

    const ignorePatterns = [...(config.ignore || []), ...gitignorePatterns]
      .map((p) => p.trim())
      .filter((p) => p);

    const ig = ignore().add(ignorePatterns);

    const getColor = (
      colorName: string,
      defaultColor: keyof ChalkInstance = "yellow",
    ): ChalkInstance => {
      if (!config.color) return chalk;
      const colorKey = (config.colors?.[colorName] ||
        defaultColor) as keyof ChalkInstance;
      return (chalk[colorKey] ||
        chalk[defaultColor]) as unknown as ChalkInstance;
    };

    const structure = await traverseDirectory(
      projectPath,
      0,
      config.depth!,
      ig,
      projectPath,
    );

    if (!config.contentsOnly) {
      console.log(getColor("directory")(`Structure of ${projectPath}:`));
      printStructure(structure, [], config, getColor);
    }

    if (!config.structureOnly) {
      const allFiles = collectFiles(structure, projectPath);
      const filesToInclude = allFiles.filter((file) =>
        shouldIncludeFile(file, config.extensions || []),
      );

      console.log(getColor("content")("\nContent of files:"));
      for (const file of filesToInclude) {
        await printFileContents(file, projectPath, config, getColor);
      }
    }
  } catch (error) {
    console.error(
      chalk.redBright("Error:"),
      error instanceof Error ? error.message : "Unknown error",
    );
    process.exit(1);
  }
}

async function readGitignore(projectPath: string): Promise<string[]> {
  try {
    const content = await readFile(join(projectPath, ".gitignore"), "utf-8");
    console.log(
      chalk.green(
        "Use .gitignore file. If you want to disable it, use --no-gitignore\n",
      ),
    );
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
  } catch {
    return [];
  }
}

async function traverseDirectory(
  dirPath: string,
  currentDepth: number,
  maxDepth: number,
  ig: Ignore,
  projectPath: string,
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

      const relativePath = relative(projectPath, entryPath)
        .split(sep)
        .join("/");
      if (ig.ignores(relativePath)) {
        processedEntries.push({
          name: entryName,
          isDirectory,
          isSymlink,
          ignored: true,
        });
        continue;
      }

      if (isSymlink) {
        processedEntries.push({
          name: `${entryName} →`,
          isDirectory: false,
          isSymlink: true,
        });
        continue;
      }

      if (isDirectory) {
        const children = await traverseDirectory(
          entryPath,
          currentDepth + 1,
          maxDepth,
          ig,
          projectPath,
        );
        processedEntries.push({
          name: entryName,
          isDirectory: true,
          isSymlink: false,
          children,
        });
      } else {
        processedEntries.push({
          name: entryName,
          isDirectory: false,
          isSymlink: false,
        });
      }
    }

    return processedEntries.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.error(chalk.yellow(`Warning: Skipping ${dirPath}`));
    return [];
  }
}

function printStructure(
  entries: Entry[],
  prefixes: string[],
  config: Config,
  getColor: (
    colorName: string,
    defaultColor?: keyof ChalkInstance,
  ) => ChalkInstance,
) {
  const lastIndex = entries.length - 1;
  entries.forEach((entry, index) => {
    if (entry.ignored) return;

    const isLast = index === lastIndex;
    const connector = isLast
      ? config.symbols?.end ?? "└──"
      : config.symbols?.branch ?? "├──";
    const currentPrefix = prefixes.join("");

    let entryName = entry.name;
    if (entry.isDirectory) {
      entryName = getColor("directory")(entryName + "/");
    } else if (entry.isSymlink) {
      entryName = getColor("symlink")(entryName);
    } else {
      entryName = getColor("file")(entryName);
    }

    console.log(`${currentPrefix}${connector} ${entryName}`);

    if (entry.children) {
      const newPrefixes = [...prefixes];
      newPrefixes.push(
        isLast
          ? config.symbols?.space ?? "    "
          : `${config.symbols?.vertical ?? "│"}   `,
      );
      printStructure(entry.children, newPrefixes, config, getColor);
    }
  });
}

function collectFiles(entries: Entry[], basePath: string): string[] {
  return entries.flatMap((entry) => {
    if (entry.ignored) return [];
    const entryPath = join(basePath, entry.name.split(" →")[0]);
    if (entry.isDirectory && entry.children) {
      return collectFiles(entry.children, entryPath);
    }
    return [entryPath];
  });
}

function shouldIncludeFile(filePath: string, extensions: string[]): boolean {
  if (extensions.length === 0) return true;

  const ext = extname(filePath).slice(1).toLowerCase();
  return extensions.some((e) => e.toLowerCase() === ext);
}

async function printFileContents(
  filePath: string,
  basePath: string,
  config: Config,
  getColor: (
    colorName: string,
    defaultColor?: keyof ChalkInstance,
  ) => ChalkInstance,
) {
  try {
    const fileBuffer = await readFile(filePath);
    if (!isText(filePath, fileBuffer)) return;
    const content = fileBuffer.toString("utf-8");
    const relativePath = relative(basePath, filePath);
    const color = getColor("content");

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
    console.error(chalk.yellow(`\nWarning: Could not read ${filePath}`));
  }
}

main();
