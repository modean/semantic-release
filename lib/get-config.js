const {castArray, pickBy, isUndefined, isNull, isString, isPlainObject} = require('lodash');
const readPkgUp = require('read-pkg-up');
const cosmiconfig = require('cosmiconfig');
const resolveFrom = require('resolve-from');
const debug = require('debug')('semantic-release:config');
const {repoUrl, fetch} = require('./git');
const getTags = require('./get-tags');
const getBranches = require('./branches');
const PLUGINS_DEFINITIONS = require('./definitions/plugins');
const plugins = require('./plugins');

const CONFIG_NAME = 'release';
const CONFIG_FILES = [
  'package.json',
  `.${CONFIG_NAME}rc`,
  `.${CONFIG_NAME}rc.json`,
  `.${CONFIG_NAME}rc.yaml`,
  `.${CONFIG_NAME}rc.yml`,
  `.${CONFIG_NAME}rc.js`,
  `${CONFIG_NAME}.config.js`,
];

module.exports = async (opts, logger) => {
  const {config} = (await cosmiconfig(CONFIG_NAME, {searchPlaces: CONFIG_FILES}).search()) || {};
  // Merge config file options and CLI/API options
  let options = {...config, ...opts};
  const pluginsPath = {};
  let extendPaths;
  ({extends: extendPaths, ...options} = options);
  if (extendPaths) {
    // If `extends` is defined, load and merge each shareable config with `options`
    options = {
      ...castArray(extendPaths).reduce((result, extendPath) => {
        const extendsOpts = require(resolveFrom.silent(__dirname, extendPath) ||
          resolveFrom(process.cwd(), extendPath));

        // For each plugin defined in a shareable config, save in `pluginsPath` the extendable config path,
        // so those plugin will be loaded relatively to the config file
        Object.entries(extendsOpts).reduce((pluginsPath, [option, value]) => {
          if (PLUGINS_DEFINITIONS[option]) {
            castArray(value)
              .filter(plugin => isString(plugin) || (isPlainObject(plugin) && isString(plugin.path)))
              .map(plugin => (isString(plugin) ? plugin : plugin.path))
              .forEach(plugin => {
                pluginsPath[plugin] = extendPath;
              });
          }
          return pluginsPath;
        }, pluginsPath);

        return {...result, ...extendsOpts};
      }, {}),
      ...options,
    };
  }

  // Set default options values if not defined yet
  options = {
    // TODO for backward compatibility only - remove on next major release
    branches: [options.branch || 'master'],
    repositoryUrl: (await pkgRepoUrl()) || (await repoUrl()),
    tagFormat: `v\${version}`,
    // Remove `null` and `undefined` options so they can be replaced with default ones
    ...pickBy(options, option => !isUndefined(option) && !isNull(option)),
  };

  await fetch();

  // Normalize and verify branches
  options.branches = await getBranches(
    await getTags({
      branches: options.branches.map(branch => (isString(branch) ? {name: branch} : branch)),
      tagFormat: options.tagFormat,
    })
  );

  // TODO for backward compatibility only - remove on next major release
  options = {
    branch: options.branches[0].name,
    ...options,
  };

  debug('options values: %O', options);

  return {options, plugins: await plugins(options, pluginsPath, logger)};
};

async function pkgRepoUrl() {
  const {pkg} = await readPkgUp({normalize: false});
  return pkg && (isPlainObject(pkg.repository) ? pkg.repository.url : pkg.repository);
}
