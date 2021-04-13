/*
* project-types.ts
*
* Copyright (C) 2020 by RStudio, PBC
*
*/

import { PandocFlags } from "../../config/flags.ts";
import { Format, FormatExtras } from "../../config/format.ts";
import { ProjectContext } from "../project-context.ts";

import { PandocRenderer } from "../../command/render/render.ts";

import { bookProjectType } from "./project-book.ts";
import { defaultProjectType } from "./project-default.ts";
import { websiteProjectType } from "./website/website.ts";

export interface ProjectType {
  type: string;
  create: (title: string) => ProjectCreate;
  libDir?: string;
  outputDir?: string;
  formatExtras?: (
    context: ProjectContext,
    input: string,
    flags: PandocFlags,
    format: Format,
  ) => Promise<FormatExtras>;
  metadataFields?: () => string[];
  resourceIgnoreFields?: () => string[];
  preRender?: (context: ProjectContext) => Promise<void>;
  pandocRenderer?: () => PandocRenderer;
  postRender?: (
    context: ProjectContext,
    incremental: boolean,
    outputFiles: ProjectOutputFile[],
  ) => Promise<void>;
}

export interface ProjectOutputFile {
  file: string;
  format: Format;
}

export interface ProjectCreate {
  configTemplate: string;
  resourceDir: string;
  scaffold?: ProjectScaffoldFile[];
  supporting?: string[];
}

export interface ProjectScaffoldFile {
  name: string;
  content: string;
  title?: string;
  format?: string;
}

const kTypes = [
  defaultProjectType,
  websiteProjectType,
  bookProjectType,
];

export function projectTypes(): string[] {
  return kTypes.map((type) => type.type);
}

export function projectType(type = "default"): ProjectType {
  const projectType = kTypes.find((pt) => pt.type === type);
  if (projectType) {
    return projectType;
  } else {
    throw new Error(`Unsuppported project type ${type}`);
  }
}
