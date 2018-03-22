import { execSync } from 'child_process';
import * as path from 'path';
import {
  affectedApps,
  ProjectNode,
  ProjectType,
  touchedProjects
} from './affected-apps';
import * as fs from 'fs';
import {
  dependencies,
  Dependency
} from '@nrwl/schematics/src/command-line/affected-apps';
import { readFileSync, statSync } from 'fs';

export function parseFiles(
  args: string[]
): { files: string[]; rest: string[] } {
  let unnamed = [];
  let named = [];
  args.forEach(a => {
    if (a.startsWith('--') || a.startsWith('-')) {
      named.push(a);
    } else {
      unnamed.push(a);
    }
  });

  const dashDashFiles = named.filter(a => a.startsWith('--files='))[0];
  if (dashDashFiles) {
    named.splice(named.indexOf(dashDashFiles), 1);
    return {
      files: parseDashDashFiles(dashDashFiles),
      rest: [...unnamed, ...named]
    };
  } else if (unnamed.length >= 2) {
    return {
      files: getFilesFromShash(unnamed[0], unnamed[1]),
      rest: [...unnamed.slice(2), ...named]
    };
  } else {
    throw new Error('Invalid options provided');
  }
}

function parseDashDashFiles(dashDashFiles: string): string[] {
  let f = dashDashFiles.substring(8); // remove --files=
  if (f.startsWith('"') || f.startsWith("'")) {
    f = f.substring(1, f.length - 1);
  }
  return f.split(',').map(f => f.trim());
}

function getFilesFromShash(sha1: string, sha2: string): string[] {
  return execSync(`git diff --name-only ${sha1} ${sha2}`)
    .toString('utf-8')
    .split('\n')
    .map(a => a.trim())
    .filter(a => a.length > 0);
}

export function getProjectNodes(config) {
  return (config.apps ? config.apps : [])
    .filter(p => p.name !== '$workspaceRoot')
    .map(p => {
      return {
        name: p.name,
        root: p.root,
        type: p.root.startsWith('apps/') ? ProjectType.app : ProjectType.lib,
        tags: p.tags,
        files: allFilesInDir(path.dirname(p.root))
      };
    });
}

export function getAffectedApps(touchedFiles: string[]): string[] {
  const config = JSON.parse(fs.readFileSync('.angular-cli.json', 'utf-8'));
  const projects = getProjectNodes(config);

  if (!config.project.npmScope) {
    throw new Error(`.angular-cli.json must define the npmScope property.`);
  }

  return affectedApps(
    config.project.npmScope,
    projects,
    f => fs.readFileSync(f, 'utf-8'),
    touchedFiles
  );
}

export function getTouchedProjects(touchedFiles: string[]): string[] {
  const config = JSON.parse(fs.readFileSync('.angular-cli.json', 'utf-8'));
  const projects = getProjectNodes(config);
  if (!config.project.npmScope) {
    throw new Error(`.angular-cli.json must define the npmScope property.`);
  }
  return touchedProjects(projects, touchedFiles).filter(p => !!p);
}

export function getProjectRoots(projectNames: string[]): string[] {
  const config = JSON.parse(fs.readFileSync('.angular-cli.json', 'utf-8'));
  const projects = getProjectNodes(config);
  return projectNames.map(name =>
    path.dirname(projects.filter(p => p.name === name)[0].root)
  );
}

function allFilesInDir(dirName: string): string[] {
  let res = [];
  fs.readdirSync(dirName).forEach(c => {
    const child = path.join(dirName, c);
    try {
      if (!fs.statSync(child).isDirectory()) {
        res.push(normalizePath(child));
      } else if (fs.statSync(child).isDirectory()) {
        res = [...res, ...allFilesInDir(child)];
      }
    } catch (e) {}
  });
  return res;
}

export function readDependencies(
  npmScope: string,
  projectNodes: ProjectNode[]
): { [projectName: string]: Dependency[] } {
  const m = lastModifiedAmongProjectFiles();
  if (!directoryExists('./dist')) {
    fs.mkdirSync('./dist');
  }
  if (!fileExists('./dist/nxdeps.json') || m > mtime('./dist/nxdeps.json')) {
    const deps = dependencies(npmScope, projectNodes, f =>
      fs.readFileSync(f, 'UTF-8')
    );
    fs.writeFileSync(
      './dist/nxdeps.json',
      JSON.stringify(deps, null, 2),
      'UTF-8'
    );
    return deps;
  } else {
    return JSON.parse(fs.readFileSync('./dist/nxdeps.json', 'UTF-8'));
  }
}

export function lastModifiedAmongProjectFiles() {
  return [
    recursiveMtime('libs'),
    recursiveMtime('apps'),
    mtime('.angular-cli.json'),
    mtime('tslint.json'),
    mtime('package.json')
  ].reduce((a, b) => (a > b ? a : b), 0);
}

function recursiveMtime(dirName: string) {
  let res = mtime(dirName);
  fs.readdirSync(dirName).forEach(c => {
    const child = path.join(dirName, c);
    try {
      if (!fs.statSync(child).isDirectory()) {
        const c = mtime(child);
        if (c > res) {
          res = c;
        }
      } else if (fs.statSync(child).isDirectory()) {
        const c = recursiveMtime(child);
        if (c > res) {
          res = c;
        }
      }
    } catch (e) {}
  });
  return res;
}

function mtime(f: string): number {
  return fs.fstatSync(fs.openSync(f, 'r')).mtime.getTime();
}

function normalizePath(file: string): string {
  return file.split(path.sep).join('/');
}

function directoryExists(filePath: string): boolean {
  try {
    return statSync(filePath).isDirectory();
  } catch (err) {
    return false;
  }
}

function fileExists(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch (err) {
    return false;
  }
}