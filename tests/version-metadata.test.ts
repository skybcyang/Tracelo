import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('keeps plugin, lockfile and native application versions aligned', () => {
  const read = (path: string) => readFileSync(path, 'utf8');
  const manifest = JSON.parse(read('manifest.json'));
  const lock = JSON.parse(read('package-lock.json'));
  expect(JSON.parse(read('package.json')).version).toBe(manifest.version);
  expect(lock.version).toBe(manifest.version);
  expect(lock.packages[''].version).toBe(manifest.version);
  expect(JSON.parse(read('versions.json'))[manifest.version]).toBe(manifest.minAppVersion);
  const windows = read('desktop/windows/TraceloCapture/TraceloCapture.csproj');
  expect(windows.match(/<Version>([^<]+)<\/Version>/)?.[1]).toBe(manifest.version);
  const macos = read('desktop/Info.plist');
  for (const key of ['CFBundleShortVersionString', 'CFBundleVersion']) {
    expect(macos.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`))?.[1]).toBe(manifest.version);
  }
});
