import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import sharp from "sharp";

function createSvg(label, accent) {
  return `
    <svg width="960" height="720" viewBox="0 0 960 720" xmlns="http://www.w3.org/2000/svg">
      <rect width="960" height="720" fill="#fbf7ef" />
      <g opacity="0.16">
        <path d="M0 120 H960 M0 240 H960 M0 360 H960 M0 480 H960 M0 600 H960" stroke="#222" />
        <path d="M120 0 V720 M240 0 V720 M360 0 V720 M480 0 V720 M600 0 V720 M720 0 V720 M840 0 V720" stroke="#222" />
      </g>
      <g transform="translate(100 90)">
        <rect x="0" y="0" rx="28" ry="28" width="300" height="180" fill="${accent}" />
        <circle cx="500" cy="130" r="92" fill="#e09132" />
        <polygon points="660,20 760,200 560,200" fill="#136f63" />
        <path d="M110 300 C240 150 400 170 510 320 S760 500 800 430" fill="none" stroke="#24190f" stroke-width="18" stroke-linecap="round" />
        <g fill="#24190f">
          <circle cx="120" cy="470" r="16" />
          <circle cx="210" cy="535" r="12" />
          <circle cx="280" cy="470" r="16" />
          <circle cx="360" cy="535" r="12" />
          <circle cx="440" cy="470" r="16" />
        </g>
        <text x="22" y="110" font-size="72" font-family="Segoe UI" font-weight="700" fill="#fff">${label}</text>
        <text x="20" y="620" font-size="90" font-family="Georgia" fill="#24190f">Landscape Collection</text>
      </g>
    </svg>
  `;
}

function createUniqueSvg() {
  return `
    <svg width="960" height="720" viewBox="0 0 960 720" xmlns="http://www.w3.org/2000/svg">
      <rect width="960" height="720" fill="#0d1b2a" />
      <g transform="translate(80 70)">
        <rect x="0" y="0" width="180" height="180" fill="#f4d35e" />
        <rect x="180" y="0" width="180" height="180" fill="#ee964b" />
        <rect x="360" y="0" width="180" height="180" fill="#f95738" />
        <rect x="540" y="0" width="180" height="180" fill="#faf0ca" />
        <circle cx="150" cy="420" r="120" fill="#faf0ca" />
        <circle cx="420" cy="420" r="100" fill="#f95738" />
        <rect x="560" y="300" width="220" height="220" rx="38" fill="#f4d35e" />
        <text x="20" y="640" font-size="110" font-family="Courier New" font-weight="700" fill="#faf0ca">Abstract Series</text>
      </g>
    </svg>
  `;
}

export async function generateFixtureSet(targetDir) {
  const root = resolve(targetDir);
  await mkdir(root, { recursive: true });

  const base = join(root, "base.png");
  const resized = join(root, "resized.png");
  const rotated90 = join(root, "rotated-90.png");
  const rotated12 = join(root, "rotated-12.png");
  const cropped = join(root, "cropped.png");
  const tinted = join(root, "tinted.png");
  const unique = join(root, "unique.png");

  const baseBuffer = Buffer.from(createSvg("Photo A", "#4957a6"));
  await sharp(baseBuffer).png().toFile(base);
  await sharp(baseBuffer).resize(760, 570).png().toFile(resized);
  await sharp(baseBuffer).rotate(90).png().toFile(rotated90);
  await sharp(baseBuffer).rotate(12, { background: "#fbf7ef" }).png().toFile(rotated12);

  const cropSource = await sharp(baseBuffer).png().toBuffer();
  await sharp(cropSource)
    .extract({ left: 30, top: 22, width: 900, height: 675 })
    .resize(960, 720)
    .png()
    .toFile(cropped);

  await sharp(baseBuffer)
    .modulate({ brightness: 1.1, hue: 24, saturation: 0.72 })
    .png()
    .toFile(tinted);

  await sharp(Buffer.from(createUniqueSvg())).png().toFile(unique);

  return {
    base,
    cropped,
    resized,
    rotated12,
    rotated90,
    root,
    tinted,
    unique
  };
}

export async function generateCompactFixtureSet(targetDir) {
  const root = resolve(targetDir);
  await mkdir(root, { recursive: true });

  const base = join(root, "base.png");
  const resized = join(root, "resized.png");
  const rotated12 = join(root, "rotated-12.png");
  const unique = join(root, "unique.png");

  const baseBuffer = Buffer.from(createSvg("Photo A", "#4957a6"));
  await sharp(baseBuffer).png().toFile(base);
  await sharp(baseBuffer).resize(760, 570).png().toFile(resized);
  await sharp(baseBuffer).rotate(12, { background: "#fbf7ef" }).png().toFile(rotated12);
  await sharp(Buffer.from(createUniqueSvg())).png().toFile(unique);

  return {
    base,
    resized,
    rotated12,
    root,
    unique
  };
}
