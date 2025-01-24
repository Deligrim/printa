# printa 📂

[![npm version](https://img.shields.io/npm/v/printa)](https://www.npmjs.com/package/printa)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A CLI tool to visualize project structure and display file contents

## Installation
```bash
npm install -g printa
```

## Usage
```bash
Usage: printa [options] <project>

CLI utility to list project structure and file contents

Arguments:
  project                        Path to the project folder

Options:
  -V, --version                  output the version number
  -e, --extensions <extensions>  Comma-separated list of file extensions to include (ts,js etc)
  -i, --ignore <patterns>        Comma-separated list of glob patterns to ignore files/directories
  -d, --depth <number>           Recursive search depth
  --no-color                     Disable color output
  --no-gitignore                 Disable reading .gitignore file
  --structure-only               Show only directory structure
  --contents-only                Show only file contents
  -h, --help                     display help for command
```

## Features
- Color-coded directory structure
- File content preview
- Code syntax highlighting
- Configurable ignores
- Using .gitignore by default
