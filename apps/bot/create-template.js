const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const out = path.join(__dirname, 'templates', 'featured.png');

async function main() {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const w = 1200;
  const h = 630;
  const svg = Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">`
    + `<rect width="${w}" height="${h}" fill="#000000"/>`
    + `<rect x="0" y="0" width="4" height="${h}" fill="#00ff41"/>`
    + `<rect x="0" y="0" width="${w}" height="60" fill="#001a08"/>`
    + `<rect x="0" y="${h - 50}" width="${w}" height="50" fill="#050505" stroke="#1a1a1a"/>`
    + `</svg>`,
  );
  await sharp(svg).png().toFile(out);
  console.log('Wrote', out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
