/*
* freeze.ts
*
* Copyright (C) 2020 by RStudio, PBC
*
*/

import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
} from "path/mod.ts";
import { ensureDirSync, existsSync } from "fs/mod.ts";

import { ld } from "lodash/mod.ts";

import { inputFilesDir } from "../../core/render.ts";
import { sessionTempFile } from "../../core/temp.ts";
import { md5Hash } from "../../core/hash.ts";
import {
  copyMinimal,
  removeIfEmptyDir,
  removeIfExists,
} from "../../core/path.ts";

import {
  kIncludeAfterBody,
  kIncludeBeforeBody,
  kIncludeInHeader,
} from "../../config/constants.ts";

import { ExecuteResult } from "../../execute/types.ts";

import { kProjectLibDir, ProjectContext } from "../../project/types.ts";
import { projectScratchPath } from "../../project/project-scratch.ts";

export const kProjectFreezeDir = "_freeze";
export const kOldFreezeExecuteResults = "execute";
export const kFreezeExecuteResults = "execute-results";

export function freezeExecuteResult(
  input: string,
  output: string,
  result: ExecuteResult,
) {
  // resolve includes within executeResult
  result = ld.cloneDeep(result) as ExecuteResult;
  const resolveIncludes = (
    name: "include-in-header" | "include-before-body" | "include-after-body",
  ) => {
    if (result.includes) {
      if (result.includes[name]) {
        result.includes[name] = result.includes[name]!.map((file) =>
          Deno.readTextFileSync(file)
        );
      }
    }
  };
  resolveIncludes(kIncludeInHeader);
  resolveIncludes(kIncludeBeforeBody);
  resolveIncludes(kIncludeAfterBody);

  // make the supporting dirs relative to the input file dir
  result.supporting = result.supporting.map((file) => {
    if (isAbsolute(file)) {
      return relative(Deno.realPathSync(dirname(input)), file);
    } else {
      return file;
    }
  });

  // save both the result and a hash of the input file
  const hash = freezeInputHash(input);

  // write the freeze json
  const freezeJsonFile = freezeResultFile(input, output, true);
  Deno.writeTextFileSync(
    freezeJsonFile,
    JSON.stringify({ hash, result }, undefined, 2),
  );

  // return the file
  return freezeJsonFile;
}

export function defrostExecuteResult(
  source: string,
  output: string,
  force = false,
) {
  const resultFile = freezeResultFile(source, output);
  if (existsSync(resultFile)) {
    // parse result
    const { hash, result } = JSON.parse(Deno.readTextFileSync(resultFile)) as {
      hash: string;
      result: ExecuteResult;
    };

    // use frozen version for force or equivalent source hash
    if (force || hash === freezeInputHash(source)) {
      // full path to supporting
      result.supporting = result.supporting.map((file) =>
        join(Deno.realPathSync(dirname(source)), file)
      );

      // convert includes to files
      const resolveIncludes = (
        name:
          | "include-in-header"
          | "include-before-body"
          | "include-after-body",
      ) => {
        if (result.includes) {
          if (result.includes[name]) {
            result.includes[name] = result.includes[name]!.map((content) => {
              const includeFile = sessionTempFile();
              Deno.writeTextFileSync(includeFile, content);
              return includeFile;
            });
          }
        }
      };
      resolveIncludes(kIncludeInHeader);
      resolveIncludes(kIncludeBeforeBody);
      resolveIncludes(kIncludeAfterBody);

      return result;
    }
  }
}

export function projectFreezerDir(dir: string, hidden: boolean) {
  const freezeDir = hidden
    ? projectScratchPath(dir, kProjectFreezeDir)
    : join(dir, kProjectFreezeDir);
  ensureDirSync(freezeDir);
  return Deno.realPathSync(freezeDir);
}

export function copyToProjectFreezer(
  project: ProjectContext,
  file: string,
  hidden: boolean,
  incremental: boolean,
) {
  const freezerDir = projectFreezerDir(project.dir, hidden);
  const srcFilesDir = join(project.dir, file);
  const destFilesDir = join(freezerDir, asFreezerDir(file));
  if (incremental) {
    for (const dir of Deno.readDirSync(srcFilesDir)) {
      if (dir.name === kFreezeExecuteResults) {
        const resultsDir = join(srcFilesDir, dir.name);
        const destResultsDir = join(destFilesDir, kFreezeExecuteResults);
        ensureDirSync(destResultsDir);
        for (const json of Deno.readDirSync(resultsDir)) {
          if (json.isFile) {
            Deno.copyFileSync(
              join(resultsDir, json.name),
              join(destResultsDir, json.name),
            );
          }
        }
      } else {
        copyMinimal(
          join(srcFilesDir, dir.name),
          join(destFilesDir, dir.name),
        );
      }
    }
  } else {
    copyMinimal(srcFilesDir, destFilesDir);
  }
}

export function copyFromProjectFreezer(
  project: ProjectContext,
  file: string,
  hidden: boolean,
) {
  const freezerDir = projectFreezerDir(project.dir, hidden);
  const srcFilesDir = join(
    freezerDir,
    asFreezerDir(file),
  );
  const destFilesDir = join(project.dir, file);
  if (existsSync(srcFilesDir)) {
    copyMinimal(srcFilesDir, destFilesDir);
  }
}

export function pruneProjectFreezerDir(
  project: ProjectContext,
  dir: string,
  files: string[],
  hidden: boolean,
) {
  const freezerDir = projectFreezerDir(project.dir, hidden);
  files.map((file) => removeIfExists(join(freezerDir, dir, file)));
  removeIfEmptyDir(join(freezerDir, dir));
}

export function pruneProjectFreezer(project: ProjectContext, hidden: boolean) {
  const freezerDir = projectFreezerDir(project.dir, hidden);
  const libDir = project.config?.project[kProjectLibDir];
  if (libDir) {
    let remove = true;
    for (const entry of Deno.readDirSync(freezerDir)) {
      if (entry.isFile || entry.name !== libDir) {
        remove = false;
        break;
      }
    }
    if (remove) {
      removeIfExists(freezerDir);
    }
  } else {
    removeIfEmptyDir(freezerDir);
  }
}

export function freezerFreezeFile(project: ProjectContext, freezeFile: string) {
  const filesDir = asFreezerDir(dirname(dirname(freezeFile)));
  return join(
    project.dir,
    kProjectFreezeDir,
    filesDir,
    kFreezeExecuteResults,
    basename(freezeFile),
  );
}

export function freezerFigsDir(
  project: ProjectContext,
  filesDir: string,
  figsDir: string,
) {
  return join(
    project.dir,
    kProjectFreezeDir,
    asFreezerDir(filesDir),
    figsDir,
  );
}

export function freezeResultFile(
  input: string,
  output: string,
  ensureDir = false,
) {
  const filesDir = join(dirname(input), inputFilesDir(input));
  const freezeDir = join(filesDir, kFreezeExecuteResults);
  if (ensureDir) {
    ensureDirSync(freezeDir);
  }

  return join(freezeDir, extname(output).slice(1) + ".json");
}

export function removeFreezeResults(filesDir: string) {
  const freezeDir = join(filesDir, kFreezeExecuteResults);
  removeIfExists(freezeDir);
  const oldFreezeDir = join(filesDir, kOldFreezeExecuteResults);
  removeIfExists(oldFreezeDir);
  if (existsSync(filesDir)) {
    removeIfEmptyDir(filesDir);
  }
}

function freezeInputHash(input: string) {
  return md5Hash(Deno.readTextFileSync(input));
}

// don't use _files suffix in freezer
function asFreezerDir(dir: string) {
  return dir.replace(/_files$/, "");
}
