/*
* format-reveal-plugin.ts
*
* Copyright (C) 2021 by RStudio, PBC
*
*/

import { existsSync } from "fs/mod.ts";
import { join } from "path/mod.ts";
import { kIncludeInHeader, kSelfContained } from "../../config/constants.ts";

import {
  Format,
  FormatDependency,
  FormatExtras,
  kDependencies,
  kTemplatePatches,
  Metadata,
  PandocFlags,
} from "../../config/types.ts";
import { camelToKebab, mergeConfigs } from "../../core/config.ts";
import { copyMinimal, pathWithForwardSlashes } from "../../core/path.ts";
import { formatResourcePath } from "../../core/resources.ts";
import { sessionTempFile } from "../../core/temp.ts";
import { readYaml } from "../../core/yaml.ts";
import { optionsToKebab, revealMetadataFilter } from "./format-reveal.ts";
import { revealMultiplexPlugin } from "./format-reveal-multiplex.ts";
import { isSelfContained } from "../../command/render/render.ts";

const kRevealjsPlugins = "revealjs-plugins";

const kRevealSlideTone = "slide-tone";
const kRevealMenu = "menu";
const kRevealChalkboard = "chalkboard";

const kRevealPluginOptions = [
  // reveal.js-menu
  "side",
  "width",
  "numbers",
  "titleSelector",
  "useTextContentForMissingTitles",
  "hideMissingTitles",
  "markers",
  "custom",
  "themes",
  "themesPath",
  "transitions",
  "openButton",
  "openSlideNumber",
  "keyboard",
  "sticky",
  "autoOpen",
  "delayInit",
  "openOnInit",
  "loadIcons",
  // reveal.js-chalkboard
  "boardmarkerWidth",
  "chalkWidth",
  "chalkEffect",
  "storage",
  "src",
  "readOnly",
  "transition",
  "theme",
  "background",
  "grid",
  "eraser",
  "boardmarkers",
  "chalks",
  "rememberColor",
  // reveal-pdfexport
  "pdfExportShortcut",
];

const kRevealPluginKebabOptions = optionsToKebab(kRevealPluginOptions);

interface RevealPluginBundle {
  plugin: string;
  config?: Metadata;
}

interface RevealPlugin {
  path: string;
  name: string;
  register?: boolean;
  script?: RevealPluginScript[];
  stylesheet?: string[];
  config?: Metadata;
  metadata?: string[];
  [kSelfContained]?: boolean;
}

interface RevealPluginScript {
  path: string;
  async?: boolean;
}

export function revealPluginExtras(
  format: Format,
  flags: PandocFlags,
  revealDir: string,
) {
  // directory to copy plugins into
  const pluginsDir = join(revealDir, "plugin");

  // accumlate content to inject
  const register: string[] = [];
  const scripts: RevealPluginScript[] = [];
  const stylesheets: string[] = [];
  const config: Metadata = {};
  const metadata: string[] = [];
  const dependencies: FormatDependency[] = [];

  // built-in plugins
  const pluginBundles: Array<RevealPluginBundle | string> = [
    {
      plugin: formatResourcePath("revealjs", join("plugins", "line-highlight")),
    },
    { plugin: formatResourcePath("revealjs", join("plugins", "a11y")) },
    {
      plugin: formatResourcePath("revealjs", join("plugins", "leaflet-compat")),
    },
    { plugin: formatResourcePath("revealjs", join("plugins", "footer")) },
    { plugin: formatResourcePath("revealjs", join("plugins", "pdfexport")) },
  ];

  // menu plugin (enabled by default)
  const menuPlugin = revealMenuPlugin(format);
  if (menuPlugin) {
    pluginBundles.push(menuPlugin);
  }

  // chalkboard plugin (optional)
  const chalkboardPlugiln = revealChalkboardPlugin(format);
  if (chalkboardPlugiln) {
    pluginBundles.push(chalkboardPlugiln);
  }

  // tone plugin (optional)
  const tonePlugin = revealTonePlugin(format);
  if (tonePlugin) {
    dependencies.push(toneDependency());
    pluginBundles.push(tonePlugin);
  }

  // multiplex plugin (optional)
  const multiplexPlugin = revealMultiplexPlugin(format);
  if (multiplexPlugin) {
    pluginBundles.push(multiplexPlugin);
  }

  if (Array.isArray(format.metadata[kRevealjsPlugins])) {
    pluginBundles.push(
      ...(format.metadata[kRevealjsPlugins] as Array<
        RevealPluginBundle | string
      >),
    );
  }

  // add footer plugin
  pluginBundles.push(
    { plugin: formatResourcePath("revealjs", join("plugins", "footer")) },
  );

  // read plugins
  for (let bundle of pluginBundles) {
    // convert string to plugin
    if (typeof (bundle) === "string") {
      bundle = {
        plugin: bundle,
      };
    }

    // read from bundle
    const plugin = pluginFromBundle(bundle);

    // check for self-contained incompatibility
    if (isSelfContained(flags, format)) {
      if (plugin[kSelfContained] === false) {
        throw new Error(
          "Reveal plugin '" + plugin.name +
            " is not compatible with self-contained output",
        );
      }
    }

    // note name
    if (plugin.register !== false) {
      register.push(plugin.name);
    }

    // copy plugin (plugin dir uses a kebab-case version of name)
    const pluginDir = join(pluginsDir, camelToKebab(plugin.name));
    copyMinimal(bundle.plugin, pluginDir);

    // note scripts
    if (plugin.script) {
      for (const script of plugin.script) {
        script.path = join(pluginDir, script.path);
        scripts.push(script);
      }
    }

    // note stylesheet
    if (plugin.stylesheet) {
      for (const stylesheet of plugin.stylesheet) {
        const pluginStylesheet = join(pluginDir, stylesheet);
        stylesheets.push(pathWithForwardSlashes(pluginStylesheet));
      }
    }

    // add to config
    if (plugin.config) {
      for (const key of Object.keys(plugin.config)) {
        if (typeof (plugin.config[key]) === "object") {
          config[key] = plugin.config[key];

          // see if the user has yaml to merge
          const kebabKey = camelToKebab(key);
          if (typeof (format.metadata[kebabKey]) === "object") {
            config[key] = mergeConfigs(
              revealMetadataFilter(
                config[key] as Metadata,
                kRevealPluginKebabOptions,
              ),
              revealMetadataFilter(
                format.metadata[kebabKey] as Metadata,
                kRevealPluginKebabOptions,
              ),
            );
          }
        }
      }
    }

    // note metadata we should forward into reveal config
    if (plugin.metadata) {
      metadata.push(...plugin.metadata);
    }
  }

  // inject them into extras
  const extras: FormatExtras = {
    [kIncludeInHeader]: [],
    html: {
      [kDependencies]: dependencies,
      [kTemplatePatches]: [],
    },
  };

  // link tags for stylesheets
  const linkTags = stylesheets.map((file) => {
    return `<link href="${file}" rel="stylesheet">`;
  }).join("\n");
  const linkTagsInclude = sessionTempFile({ suffix: ".html" });
  Deno.writeTextFileSync(linkTagsInclude, linkTags);
  extras[kIncludeInHeader]?.push(linkTagsInclude);

  // patch function for script + reveal registration
  extras.html?.[kTemplatePatches]?.push((template) => {
    // plugin scripts
    const kRevealJsPlugins = "<!-- reveal.js plugins -->";
    const scriptTags = scripts.map((file) => {
      const async = file.async ? " async" : "";
      return `  <script src="${file.path}"${async}></script>`;
    }).join("\n");
    template = template.replace(
      kRevealJsPlugins,
      kRevealJsPlugins + "\n" + scriptTags,
    );
    // plugin registration
    if (register.length > 0) {
      const kRevealPluginArray = "plugins: [";
      template = template.replace(
        kRevealPluginArray,
        kRevealPluginArray + register.join(", ") + ",\n",
      );
    }

    // inject top level options used by plugins into config
    metadata.forEach((option) => {
      if (format.metadata[option] !== undefined) {
        config[option] = format.metadata[option];
      }
    });

    // plugin config
    template = injectRevealConfig(config, template);

    // return patched template
    return template;
  });

  // return
  return extras;
}

export function injectRevealConfig(
  config: Record<string, unknown>,
  template: string,
) {
  // plugin config
  const configJs: string[] = [];
  Object.keys(config).forEach((key) => {
    configJs.push(`'${key}': ${JSON.stringify(config[key])}`);
  });
  if (configJs.length > 0) {
    const kRevealInitialize = "Reveal.initialize({";
    template = template.replace(
      kRevealInitialize,
      kRevealInitialize + "\n" + configJs.join(",\n") + ",\n",
    );
  }
  return template;
}

function revealMenuPlugin(format: Format) {
  return {
    plugin: formatResourcePath("revealjs", join("plugins", "menu")),
    config: {
      menu: {
        custom: [{
          title: "Tools",
          icon: '<i class="fas fa-gear"></i>',
          content: revealMenuTools(format),
        }],
        openButton: format.metadata[kRevealMenu] !== false,
      },
    },
  };
}

function revealChalkboardPlugin(format: Format) {
  if (format.metadata[kRevealChalkboard]) {
    return {
      plugin: formatResourcePath("revealjs", join("plugins", "chalkboard")),
    };
  } else {
    return undefined;
  }
}

function revealMenuTools(format: Format) {
  const tools = [
    {
      title: "Fullscreen",
      key: "f",
      handler: "fullscreen",
    },
    {
      title: "Speaker View",
      key: "s",
      handler: "speakerMode",
    },
    {
      title: "Slide Overview",
      key: "o",
      handler: "overview",
    },
    {
      title: "PDF Export Mode",
      key: "e",
      handler: "overview",
    },
  ];
  if (format.metadata[kRevealChalkboard]) {
    tools.push(
      {
        title: "Toggle Chalkboard",
        key: "b",
        handler: "toggleChalkboard",
      },
      {
        title: "Toggle Notes Canvas",
        key: "c",
        handler: "toggleNotesCanvas",
      },
      {
        title: "Download Drawings",
        key: "d",
        handler: "downloadDrawings",
      },
    );
  }
  tools.push({
    title: "Keyboard Help",
    key: "?",
    handler: "keyboardHelp",
  });
  const lines = ['<ul class="slide-menu-items">'];
  lines.push(...tools.map((tool, index) => {
    return `<li class="slide-tool-item${
      index === 0 ? " active" : ""
    }" data-item="${index}"><a href="#" onclick="RevealMenuToolHandlers.${tool.handler}(event)"><kbd>${tool
      .key || " "}</kbd> ${tool.title}</a></li>`;
  }));

  lines.push("</ul>");
  return lines.join("\n");
}

function revealTonePlugin(format: Format) {
  if (format.metadata[kRevealSlideTone]) {
    return { plugin: formatResourcePath("revealjs", join("plugins", "tone")) };
  } else {
    return undefined;
  }
}

function toneDependency() {
  const dependency: FormatDependency = {
    name: "tone",
    scripts: [{
      name: "tone.js",
      path: formatResourcePath("revealjs", join("tone", "tone.js")),
    }],
  };
  return dependency;
}

function pluginFromBundle(bundle: RevealPluginBundle): RevealPlugin {
  // confirm it's a directory
  if (!existsSync(bundle.plugin) || !Deno.statSync(bundle.plugin).isDirectory) {
    throw new Error(
      "Specified Reveal plugin directory '" + bundle.plugin +
        "' does not exist.",
    );
  }
  // read the plugin definition (and provide the path)
  const plugin = readYaml(join(bundle.plugin, "plugin.yml")) as RevealPlugin;
  plugin.path = bundle.plugin;

  // convert script and stylesheet to arrays
  if (plugin.script && !Array.isArray(plugin.script)) {
    plugin.script = [plugin.script];
  }
  plugin.script = plugin.script?.map((script) => {
    if (typeof (script) === "string") {
      return {
        path: script,
      };
    } else {
      return script;
    }
  });

  if (plugin.stylesheet && !Array.isArray(plugin.stylesheet)) {
    plugin.stylesheet = [plugin.stylesheet];
  }
  plugin.stylesheet = plugin.stylesheet?.map((stylesheet) =>
    String(stylesheet)
  );

  // validate plugin
  validatePlugin(plugin);

  // merge user config into plugin config
  if (typeof (bundle.config) === "object") {
    plugin.config = mergeConfigs(
      plugin.config || {} as Metadata,
      bundle.config || {} as Metadata,
    );
  }

  // ensure that metadata is an array
  if (typeof (plugin.metadata) === "string") {
    plugin.metadata = [plugin.metadata];
  }

  // return plugin
  return plugin;
}

function validatePlugin(plugin: RevealPlugin) {
  if (typeof (plugin.name) !== "string") {
    throw new Error("Reveal plugin definition must include a name.");
  }
  if (!Array.isArray(plugin.script)) {
    throw new Error("Reveal plugin definition must include a script.");
  }
  for (const script of plugin.script) {
    if (!existsSync(join(plugin.path, script.path))) {
      throw new Error(
        "Reveal plugin script '" + script + "' not found.",
      );
    }
  }

  if (plugin.stylesheet) {
    for (const stylesheet of plugin.stylesheet) {
      if (!existsSync(join(plugin.path, stylesheet))) {
        throw new Error(
          "Reveal plugin stylesheet '" + stylesheet + "' not found.",
        );
      }
    }
  }
  if (plugin.config) {
    if (
      typeof (plugin.config) !== "object"
    ) {
      throw new Error(
        "Reveal plugin config must be an object.",
      );
    }
  }
}
