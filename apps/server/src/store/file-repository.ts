import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MemoryRepository, type LedgerSnapshot } from '@finorchestrate/core';

/**
 * Single JSON document on disk. Writes go to a temporary file first and are
 * renamed into place, so a crash mid write never leaves a half written ledger.
 */
export class FileRepository extends MemoryRepository {
  private loaded = false;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {
    super(null);
  }

  override async load(): Promise<LedgerSnapshot | null> {
    if (!this.loaded) {
      try {
        this.snapshot = JSON.parse(await readFile(this.file, 'utf8')) as LedgerSnapshot;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        this.snapshot = null;
      }
      this.loaded = true;
    }
    return super.load();
  }

  protected override async persist(): Promise<void> {
    const data = JSON.stringify(this.snapshot);
    const write = async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.${process.pid}.tmp`;
      await writeFile(temp, data, 'utf8');
      await rename(temp, this.file);
    };
    this.writing = this.writing.then(write, write);
    await this.writing;
  }
}
