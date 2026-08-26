const { existsSync, renameSync } = require('node:fs');
const path = require('node:path');

const gypPath = path.join(__dirname, '../native/macos-calendar/binding.gyp');
const skippedPath = `${gypPath}.win-skip`;

module.exports = async function afterPack() {
  if (existsSync(skippedPath)) {
    renameSync(skippedPath, gypPath);
  }
};
