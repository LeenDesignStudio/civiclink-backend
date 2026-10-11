import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { UpstreamError, ValidationError } from '../../lib/errors.js';
import { BULK_CAP, type ZipConvertRequest } from './types.js';

export function ogrArguments(paths: {
  zipPath: string;
  outPath: string;
  shapefile?: string;
  where?: string;
  clipPath?: string;
}): string[] {
  const args = ['-f', 'GeoJSON', '-t_srs', 'EPSG:4326'];
  if (paths.where) args.push('-where', paths.where);
  if (paths.clipPath) args.push('-clipsrc', paths.clipPath);
  const source = paths.shapefile ? `/vsizip/${paths.zipPath}/${paths.shapefile}` : `/vsizip/${paths.zipPath}`;
  args.push(paths.outPath, source);
  return args;
}

export async function convertTigerZip(request: ZipConvertRequest): Promise<Uint8Array> {
  if (request.zip.byteLength > BULK_CAP) throw new ValidationError('Download exceeded the size cap.');
  const dir = await mkdtemp(path.join(tmpdir(), 'civiclink-tiger-'));
  try {
    const zipPath = path.join(dir, 'layer.zip');
    const outPath = path.join(dir, 'layer.geojson');
    await writeFile(zipPath, request.zip);
    let clipPath: string | undefined;
    if (request.clipGeoJson) {
      clipPath = path.join(dir, 'clip.geojson');
      await writeFile(clipPath, request.clipGeoJson);
    }
    await runCommand(
      'ogr2ogr',
      ogrArguments({
        zipPath,
        outPath,
        ...(request.shapefile ? { shapefile: request.shapefile } : {}),
        ...(request.where ? { where: request.where } : {}),
        ...(clipPath ? { clipPath } : {}),
      }),
      request.layer,
    );
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runCommand(command: string, args: string[], layer: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const stderr: Buffer[] = [];
    let stderrBytes = 0;
    let settled = false;
    const fail = (err: UpstreamError) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderrBytes > 8192) return;
      stderr.push(chunk);
      stderrBytes += chunk.length;
    });
    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') fail(new UpstreamError('ogr2ogr is not on PATH.'));
      else fail(new UpstreamError(`ogr2ogr could not be started for ${layer}.`));
    });
    child.on('close', (code) => {
      if (code === 0) {
        if (!settled) {
          settled = true;
          resolve();
        }
        return;
      }
      fail(new UpstreamError(ogrFailure(layer, Buffer.concat(stderr).toString('utf8'))));
    });
  });
}

function ogrFailure(layer: string, stderr: string): string {
  const line = stderr
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(-2)
    .join(' ')
    .replace(/\/vsizip\/\S+/g, 'zip')
    .replace(/\/tmp\/\S+/g, 'tmp')
    .slice(0, 240);
  return line.length > 0 ? `ogr2ogr failed on ${layer}: ${line}` : `ogr2ogr failed on ${layer}.`;
}
