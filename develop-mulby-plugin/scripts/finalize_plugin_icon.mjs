#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

function parseArgs(argv) {
  const args = {
    projectRoot: process.cwd(),
    svg: 'assets/icon.svg',
    out: 'icon.png',
    size: 512,
    padding: 0.08,
    updateManifest: true,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--project-root') {
      args.projectRoot = argv[index + 1]
      index += 1
    } else if (arg === '--svg') {
      args.svg = argv[index + 1]
      index += 1
    } else if (arg === '--out') {
      args.out = argv[index + 1]
      index += 1
    } else if (arg === '--size') {
      args.size = Number(argv[index + 1])
      index += 1
    } else if (arg === '--padding') {
      args.padding = Number(argv[index + 1])
      index += 1
    } else if (arg === '--sharp-root') {
      args.sharpRoot = argv[index + 1]
      index += 1
    } else if (arg === '--no-update-manifest') {
      args.updateManifest = false
    } else if (arg === '--help' || arg === '-h') {
      args.help = true
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return args
}

function printHelp() {
  console.log(`Usage:
  node scripts/finalize_plugin_icon.mjs [options]

Options:
  --project-root <dir>     Plugin project root. Defaults to cwd.
  --svg <path>             Source SVG path, relative to project root by default. Defaults to assets/icon.svg.
  --out <path>             Output PNG path, relative to project root by default. Defaults to icon.png.
  --size <px>              Output PNG size. Defaults to 512.
  --padding <ratio>        Transparent padding per edge. Defaults to 0.08.
  --sharp-root <dir>       Directory used to resolve the sharp dependency.
  --no-update-manifest     Do not set manifest.icon to the output path.
`)
}

function resolveInsideProject(projectRoot, value) {
  return path.isAbsolute(value) ? value : path.resolve(projectRoot, value)
}

function findPackageRoots(start) {
  const roots = []
  let current = path.resolve(start)
  while (true) {
    roots.push(current)
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return roots
}

function loadSharp(args, scriptDir, projectRoot) {
  const candidateRoots = [
    args.sharpRoot,
    process.env.MULBY_ICON_SHARP_ROOT,
    projectRoot,
    process.cwd(),
    scriptDir,
    path.resolve(scriptDir, '..', '..', '..'),
  ].filter(Boolean)

  const roots = new Set()
  for (const root of candidateRoots) {
    for (const candidate of findPackageRoots(root)) {
      roots.add(candidate)
    }
  }

  for (const root of roots) {
    try {
      return createRequire(path.join(root, 'package.json'))('sharp')
    } catch {}
    try {
      return createRequire(path.join(root, 'noop.js'))('sharp')
    } catch {}
  }

  try {
    return createRequire(import.meta.url)('sharp')
  } catch {
    throw new Error('Unable to resolve "sharp". Install sharp in the plugin project, or pass --sharp-root to a project that has sharp installed.')
  }
}

function validateInputs(args, sourceSvg) {
  if (!Number.isInteger(args.size) || args.size < 64 || args.size > 2048) {
    throw new Error(`--size must be an integer between 64 and 2048, got ${args.size}`)
  }
  if (!Number.isFinite(args.padding) || args.padding < 0 || args.padding >= 0.45) {
    throw new Error(`--padding must be >= 0 and < 0.45, got ${args.padding}`)
  }
  if (!existsSync(sourceSvg)) {
    throw new Error(`Source SVG not found: ${sourceSvg}`)
  }
  if (path.extname(sourceSvg).toLowerCase() !== '.svg') {
    throw new Error(`Source icon must be SVG: ${sourceSvg}`)
  }
}

function findAlphaBounds(data, info) {
  const channels = info.channels
  const alphaIndex = channels - 1
  let minX = info.width
  let minY = info.height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = ((y * info.width) + x) * channels
      if (data[offset + alphaIndex] === 0) continue
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }

  if (maxX < minX || maxY < minY) return null
  return {
    left: minX,
    top: minY,
    width: (maxX - minX) + 1,
    height: (maxY - minY) + 1,
  }
}

async function renderIcon(sharp, sourceSvg, outputPng, size, padding) {
  const inner = Math.max(1, Math.round(size * (1 - (padding * 2))))
  const border = size - inner
  const top = Math.floor(border / 2)
  const bottom = border - top
  const left = Math.floor(border / 2)
  const right = border - left

  const raster = sharp(sourceSvg, { density: 1024 }).ensureAlpha()
  const { data: rasterData, info: rasterInfo } = await raster.raw().toBuffer({ resolveWithObject: true })
  const bounds = findAlphaBounds(rasterData, rasterInfo)

  let pipeline = sharp(rasterData, { raw: rasterInfo })
  if (bounds) {
    pipeline = pipeline.extract(bounds)
  }

  mkdirSync(path.dirname(outputPng), { recursive: true })
  await pipeline
    .resize({
      width: inner,
      height: inner,
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .ensureAlpha()
    .extend({
      top,
      bottom,
      left,
      right,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(outputPng)
}

function toManifestPath(projectRoot, outputPng) {
  return path.relative(projectRoot, outputPng).split(path.sep).join('/')
}

function updateManifestIcon(projectRoot, outputPng) {
  const manifestPath = path.join(projectRoot, 'manifest.json')
  if (!existsSync(manifestPath)) {
    console.warn(`manifest.json not found, skipped manifest.icon update: ${manifestPath}`)
    return
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const iconPath = toManifestPath(projectRoot, outputPng)
  if (manifest.icon === iconPath) {
    return
  }

  manifest.icon = iconPath
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }

  const scriptDir = path.dirname(fileURLToPath(import.meta.url))
  const projectRoot = path.resolve(args.projectRoot)
  const sourceSvg = resolveInsideProject(projectRoot, args.svg)
  const outputPng = resolveInsideProject(projectRoot, args.out)

  validateInputs(args, sourceSvg)
  const sharp = loadSharp(args, scriptDir, projectRoot)

  await renderIcon(sharp, sourceSvg, outputPng, args.size, args.padding)
  if (args.updateManifest) {
    updateManifestIcon(projectRoot, outputPng)
  }

  console.log(`Finalized plugin icon: ${outputPng}`)
  console.log(`Source SVG: ${sourceSvg}`)
  console.log(`Size: ${args.size}x${args.size}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
