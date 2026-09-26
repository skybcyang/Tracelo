import * as fs from "node:fs/promises";
import { join } from "node:path";

export class DiskAdapter {
  constructor(readonly root: string) {}
  async exists(path: string) { try { await fs.access(join(this.root, path)); return true; } catch { return false; } }
  async read(path: string) { return fs.readFile(join(this.root, path), "utf8"); }
  async write(path: string, text: string) { await fs.writeFile(join(this.root, path), text); }
  async readBinary(path: string): Promise<ArrayBuffer> { const b = await fs.readFile(join(this.root, path)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; }
  async writeBinary(path: string, data: ArrayBuffer) { await fs.writeFile(join(this.root, path), new Uint8Array(data)); }
  async mkdir(path: string) { await fs.mkdir(join(this.root, path), { recursive: true }); }
  async rename(from: string, to: string) { if (await this.exists(to)) throw new Error("destination exists"); await fs.rename(join(this.root, from), join(this.root, to)); }
  async stat(path: string) { try { const s = await fs.stat(join(this.root, path)); return { type: s.isDirectory() ? "folder" as const : "file" as const, size: s.size }; } catch { return null; } }
  async list(path: string) { const entries = await fs.readdir(join(this.root, path), { withFileTypes: true }); return { files: entries.filter(e => e.isFile()).map(e => `${path}/${e.name}`), folders: entries.filter(e => e.isDirectory()).map(e => `${path}/${e.name}`) }; }
  async remove(path: string) { await fs.unlink(join(this.root, path)); }
  async rmdir(path: string, recursive: boolean) { await fs.rm(join(this.root, path), { recursive }); }
}
