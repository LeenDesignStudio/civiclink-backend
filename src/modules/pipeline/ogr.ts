import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { UpstreamError, ValidationError } from '../../lib/errors.js';
import { BULK_CAP, type ZipConvertRequest } from './types.js';

export function ogrArguments(paths: { zipPath: string; outPath: string; where?: string; clipPath?: string }): string[] {
  const args = ['-f', 'GeoJSON', '-t_srs', 'EPSG:4326'];
  if (paths.where) args.push('-where', paths.where);
  if (paths.clipPath) args.push('-clipsrc', paths.clipPath);
  args.push(paths.outPath, `/vsizip/${paths.zipPath}`);
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
        ...(request.where ? { where: request.where } : {}),
        ...(clipPath ? { clipPath } : {}),
      }),
    );
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore' });
    child.on('error', () => reject(new UpstreamError()));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new UpstreamError());
    });
  });
}
