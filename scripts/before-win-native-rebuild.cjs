const { existsSync, renameSync } = require('node:fs');
const path = require('node:path');

const gypPath = path.join(__dirname, '../native/macos-calendar/binding.gyp');
const skippedPath = `${gypPath}.win-skip`;

module.exports = async function beforeBuild(context) {
  const isWindows = context.platform.name === 'windows';

  if (isWindows && existsSync(gypPath)) {
    renameSync(gypPath, skippedPath);
    return;
  }

  if (!isWindows && existsSync(skippedPath)) {
    renameSync(skippedPath, gypPath);
  }
};
