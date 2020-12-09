'use strict';

const rollup = require('rollup');
const fs = require('fs-extra');
const path = require('path');
const argv = require('minimist')(process.argv.slice(2));
const babel = require('@rollup/plugin-babel').default;
const closure = require('./plugins/closure-plugin');
const nodeResolve = require('@rollup/plugin-node-resolve').default;
const commonjs = require('@rollup/plugin-commonjs');
const replace = require('@rollup/plugin-replace');

const license = ` * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.`;

const isWatchMode = argv.watch;
const isProduction = argv.prod;
const isWWW = argv.www;
const isClean = argv.clean;

const closureOptions = {
  compilation_level: 'SIMPLE',
  language_in: 'ECMASCRIPT_2018',
  language_out: 'ECMASCRIPT_2018',
  env: 'CUSTOM',
  warning_level: 'QUIET',
  apply_input_source_maps: false,
  use_types_for_optimization: false,
  process_common_js_modules: false,
  rewrite_polyfills: false,
  inject_libraries: false,
};

if (isClean) {
  fs.removeSync(path.resolve('./packages/outline/dist'));
}

const wwwMappings = {
  outline: 'Outline',
};

const outlineExtensions = fs
  .readdirSync(path.resolve('./packages/outline-extensions/src'))
  .map((str) => path.basename(str, '.js'));
const outlineExtensionsExternals = outlineExtensions.map((node) => {
  const external = `outline-extensions/${node.replace('Outline', '')}`;
  wwwMappings[external] = node;
  return external;
});

const outlineReactModules = fs
  .readdirSync(path.resolve('./packages/outline-react/src'))
  .map((str) => path.basename(str, '.js'));
const outlineReactModuleExternals = outlineReactModules.map((module) => {
  const external = `outline-react/${module}`;
  wwwMappings[external] = module;
  return external;
});

const externals = [
  'outline',
  'Outline',
  'outline-react',
  'outline-extensions',
  'react-dom',
  'react',
  ...outlineExtensionsExternals,
  ...outlineReactModuleExternals,
  ...Object.values(wwwMappings),
];

async function build(name, inputFile, outputFile) {
  const inputOptions = {
    input: inputFile,
    external(modulePath, src) {
      return externals.includes(modulePath);
    },
    onwarn(warning) {
      if (warning.code === 'CIRCULAR_DEPENDENCY') {
        // Ignored
      } else if (typeof warning.code === 'string') {
        // This is a warning coming from Rollup itself.
        // These tend to be important (e.g. clashes in namespaced exports)
        // so we'll fail the build on any of them.
        console.error();
        console.error(warning.message || warning);
        console.error();
        process.exit(1);
      } else {
        // The warning is from one of the plugins.
        // Maybe it's not important, so just print it.
        console.warn(warning.message || warning);
      }
    },
    plugins: [
      nodeResolve(),
      babel({
        babelHelpers: 'bundled',
        exclude: '/**/node_modules/**',
        babelrc: false,
        configFile: false,
        presets: ['@babel/preset-react'],
        plugins: ['@babel/plugin-transform-flow-strip-types'],
      }),
      commonjs(),
      isWWW && replace(wwwMappings),
      isProduction && closure(closureOptions),
      isWWW && {
        renderChunk(source) {
          return `/**
${license}
  *
  * @noflow
  * @nolint
  * @preventMunge
  * @preserve-invariant-messages
  */

${source}`;
        },
      },
    ],
  };
  const outputOptions = {
    file: outputFile,
    format: 'cjs',
    freeze: false,
    interop: false,
    esModule: false,
    externalLiveBindings: false,
    exports: 'auto',
  };
  if (isWatchMode) {
    const watcher = rollup.watch({...inputOptions, output: outputOptions});
    watcher.on('event', async (event) => {
      switch (event.code) {
        case 'BUNDLE_START':
          console.log(`Building ${name}...`);
          break;
        case 'BUNDLE_END':
          console.log(`Built ${name}`);
          break;
        case 'ERROR':
        case 'FATAL':
          console.error(`Build failed for ${name}:\n\n${event.error}`);
          break;
      }
    });
  } else {
    const result = await rollup.rollup(inputOptions);
    await result.write(outputOptions);
  }
}

outlineExtensions.forEach((outlineNode) => {
  build(
    `Outline Extensions - ${outlineNode}`,
    path.resolve(`./packages/outline-extensions/src/${outlineNode}.js`),
    path.resolve(`./packages/outline-extensions/dist/${outlineNode}.js`),
  );
});

build(
  'Outline',
  path.resolve('./packages/outline/src/index.js'),
  path.resolve('./packages/outline/dist/Outline.js'),
);

outlineReactModules.forEach((outlineReactModule) => {
  build(
    `Outline React - ${outlineReactModule}`,
    path.resolve(`./packages/outline-react/src/${outlineReactModule}.js`),
    path.resolve(`./packages/outline-react/dist/${outlineReactModule}.js`),
  );
});