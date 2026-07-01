const path = require('node:path');
const { existsSync } = require('node:fs');

const candidates = [
  path.join(__dirname, 'build/Release/macos_calendar.node'),
  path.join(__dirname, 'build/Debug/macos_calendar.node'),
];

for (const candidate of candidates) {
  if (existsSync(candidate)) {
    module.exports = require(candidate);
    return;
  }
}

throw new Error('macos_calendar native module not found');
