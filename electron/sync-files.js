const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dest = __dirname;

const items = [
    'index.html',
    'manifest.json',
    'sw.js',
    'privacidad.html',
    'js',
    'css',
    'icons'
];

function copyDir(src, dst) {
    if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dst, entry.name);
        if (entry.isDirectory()) copyDir(s, d);
        else fs.copyFileSync(s, d);
    }
}

for (const item of items) {
    const src = path.join(root, item);
    const dst = path.join(dest, item);
    if (!fs.existsSync(src)) {
        console.warn(`SKIP: ${item} no existe en la raiz`); 
        continue;
    }
    if (fs.statSync(src).isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
    console.log(`OK: ${item}`);
}

console.log('Archivos web sincronizados en electron/.');