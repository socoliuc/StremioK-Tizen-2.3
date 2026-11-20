'use strict';
const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
const widget = new JSZip();

async function build() {
    const assets = fs.readFileSync(path.join(__dirname, 'widget-files.txt'), 'utf8').trim().split(/\r?\n/);
    for (const file of assets) {
        widget.file(file, fs.readFileSync(path.join(root, file)));
    }
    fs.mkdirSync(output, { recursive: true });
    const packageFile = path.join(output, 'StremioK-Tizen-2.3-unsigned.wgt');
    fs.writeFileSync(packageFile, await widget.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
    console.log('Unsigned widget written to ' + path.relative(root, packageFile));
}

build().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
