const fs = require('node:fs');
const path = require('node:path');

if (process.platform !== 'win32') {
  const binDirectory = path.resolve(__dirname, '../node_modules/.bin');

  for (const entry of fs.readdirSync(binDirectory)) {
    fs.chmodSync(path.join(binDirectory, entry), 0o755);
  }
}
