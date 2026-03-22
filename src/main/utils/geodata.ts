import { readFile } from 'fs/promises'
import { existsSync, statSync } from 'fs'
import path from 'path'
import { mihomoWorkDir, resourcesFilesDir } from './dirs'

export type GeoDataKind = 'geoip' | 'geosite'

interface GeoDataCacheEntry {
  key: string
  values: string[]
}

const geoDataCache = new Map<GeoDataKind, GeoDataCacheEntry>()

function readVarint(buffer: Buffer, offset: number): [number, number] {
  let result = 0
  let shift = 0
  let currentOffset = offset

  while (currentOffset < buffer.length) {
    const byte = buffer[currentOffset]
    result |= (byte & 0x7f) << shift
    currentOffset += 1

    if ((byte & 0x80) === 0) {
      return [result, currentOffset]
    }

    shift += 7
  }

  throw new Error('Invalid protobuf varint')
}

function skipField(buffer: Buffer, offset: number, wireType: number): number {
  switch (wireType) {
    case 0:
      return readVarint(buffer, offset)[1]
    case 1:
      return offset + 8
    case 2: {
      const [length, nextOffset] = readVarint(buffer, offset)
      return nextOffset + length
    }
    case 5:
      return offset + 4
    default:
      throw new Error(`Unsupported protobuf wire type: ${wireType}`)
  }
}

function readNestedEntryName(message: Buffer): string | null {
  let offset = 0

  while (offset < message.length) {
    const [tag, nextOffset] = readVarint(message, offset)
    const fieldNumber = tag >> 3
    const wireType = tag & 0x07
    offset = nextOffset

    if (fieldNumber === 1 && wireType === 2) {
      const [length, valueOffset] = readVarint(message, offset)
      const endOffset = valueOffset + length
      return message.toString('utf8', valueOffset, endOffset).trim() || null
    }

    offset = skipField(message, offset, wireType)
  }

  return null
}

function readGeoDataEntryNames(buffer: Buffer): string[] {
  const values = new Set<string>()
  let offset = 0

  while (offset < buffer.length) {
    const [tag, nextOffset] = readVarint(buffer, offset)
    const fieldNumber = tag >> 3
    const wireType = tag & 0x07
    offset = nextOffset

    if (fieldNumber === 1 && wireType === 2) {
      const [length, valueOffset] = readVarint(buffer, offset)
      const endOffset = valueOffset + length
      const name = readNestedEntryName(buffer.subarray(valueOffset, endOffset))
      if (name) {
        values.add(name)
      }
      offset = endOffset
      continue
    }

    offset = skipField(buffer, offset, wireType)
  }

  return Array.from(values).sort((left, right) => left.localeCompare(right))
}

function resolveGeoDataPath(kind: GeoDataKind): string {
  const fileName = `${kind}.dat`
  const workPath = path.join(mihomoWorkDir(), fileName)
  if (existsSync(workPath)) {
    return workPath
  }

  const bundledPath = path.join(resourcesFilesDir(), fileName)
  if (existsSync(bundledPath)) {
    return bundledPath
  }

  throw new Error(`${fileName} not found`)
}

export async function getGeoDataEntries(kind: GeoDataKind): Promise<string[]> {
  const filePath = resolveGeoDataPath(kind)
  const cacheKey = `${filePath}:${existsSync(filePath) ? statSync(filePath).mtimeMs : 0}`
  const cached = geoDataCache.get(kind)
  if (cached && cached.key === cacheKey) {
    return cached.values
  }

  const buffer = await readFile(filePath)
  const values = readGeoDataEntryNames(buffer)
  geoDataCache.set(kind, {
    key: cacheKey,
    values
  })

  return values
}
