// replace with already published or later published equivalent
import { ContractContext } from '../types/abi/filestorage-1.0.1';

/**
 * @module
 * On-chain file manager for containerizing file management against users / chains
 * wrapping fs.js to serve as better isolation, type safety, reliability and intuitiveness
 * extendability to multi-fs and multi-contracts
 * consumable of stateful components in a similar manner as browser native APIs
 */

// if searching remains delegated to client-side:
// later improvement iterations can integrate file trie as index, with current iterator adapting the change
// as well considering storage options with IndexDB, and advanced uploads management
// pre-req: standardization of paths as spec from systems up to client-side, exported across SDKs

//@ts-ignore
import FileStorage, {
  FileStorageDirectory,
  FileStorageFile,
  StoragePath,
} from '@skalenetwork/filestorage.js';

//@ts-ignore
import { BehaviorSubject, Observable, of, firstValueFrom } from 'rxjs';
import { concatMap, share } from 'rxjs/operators';

import { Buffer } from 'buffer';
//@ts-ignore
import sortBy from 'lodash/sortBy';
//@ts-ignore
import mime from 'mime/lite';
import Fuse from 'fuse.js';
import { nanoid } from 'nanoid';

import utils from './utils';
const { sanitizeAddress, pathToRelative } = utils;

const KIND = {
  FILE: "file",
  DIRECTORY: "directory"
}

const ROLE = {
  OWNER: 'OWNER',
  ALLOCATOR: 'ALLOCATOR',
  CHAIN_OWNER: 'CHAIN_OWNER'
}

const OPERATION = {
  UPLOAD_FILE: 'UPLOAD_FILE',
  DELETE_FILE: 'DELETE_FILE',
  DELETE_DIRECTORY: 'DELETE_DIRECTORY',
  CREATE_DIRECTORY: 'CREATE_DIRECTORY',
  GRANT_ROLE: 'GRANT_ROLE',
  RESERVE_SPACE: 'RESERVE_SPACE'
}

// @todo-enhancement: improve error coverage, segment some to state, extend with codes
const ERROR = {
  NO_ACCOUNT: "File manager has no signer account",
  NOT_AUTHORIZED: "Signer not authorized to perform the operation",
  BUSY: "File system is currently busy",
  UNKNOWN: "Something went wrong",
  NO_NET: "You are currently offline"
}

/**
 * Interfacing based on simpified form of web FileSystem and FileSystem Access API
 * we start without file handles
 */

export type FilePath = string;
export type DePath = string;
export type Address = string;
export type PrivateKey = string;

export interface IDeDirectory {
  kind: string;
  name: string;
  path: DePath;
  entries(): Promise<Iterable<IDeFile | IDeDirectory>>;
}

export interface IDeFile {
  kind: string;
  name: string;
  path: DePath;
  type: string;
  size: number;
  timestamp?: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

class DeDirectory implements IDeDirectory {
  kind: string;
  name: string;
  path: DePath;
  manager: DeFileManager;
  parent?: DeDirectory;

  constructor(
    data: FileStorageDirectory,
    manager: DeFileManager,
    parent?: DeDirectory
  ) {
    this.kind = KIND.DIRECTORY;
    this.name = data.name;
    this.path = pathToRelative(data.storagePath);
    this.manager = manager;
    this.parent = parent;
    this.manager.indexDirectory(this);
  }

  entries() {
    return this.manager.entriesGenerator(this);
  }
}

class DeFile implements IDeFile {
  kind: string;
  name: string;
  path: DePath;
  size: number;
  type: string;
  manager: DeFileManager;
  parent?: DeDirectory;

  constructor(
    data: FileStorageFile,
    manager: DeFileManager,
    parent?: DeDirectory
  ) {
    this.kind = KIND.FILE;
    this.name = data.name;
    this.path = pathToRelative(data.storagePath);
    this.size = data.size;
    this.type = mime.getType(data.name);
    this.manager = manager;
    this.parent = parent;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const buffer = await this.manager.fs
      .downloadToBuffer(
        this.manager.rootDirectory().name + "/" + this.path
      );
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset, buffer.byteOffset + buffer.byteLength
    );
    return arrayBuffer;
  }
}

export type FileOrDir = DeDirectory | DeFile;

type OperationPayload = {
  key: string,
  promise: () => Promise<any>,
  onSuccess?: () => OperationEvent['result'],
  onError?: () => OperationEvent['result']
}

export type OperationEvent = {
  id: string;
  type: string;
  status: string;
  result?: any
};

export type FileLike = {
  name: string,
  size?: number,
  arrayBuffer?: () => Promise<ArrayBuffer>,
  buffer?: () => Buffer,
}

class DeFileManager {

  address: Address;
  account?: Address;
  accountPrivateKey?: PrivateKey;

  w3: Object;
  fs: FileStorage;
  contract: ContractContext;

  private index: { [path: string]: DeDirectory }
  private rootDir: DeDirectory;

  cache: { [key: string]: (FileStorageDirectory | FileStorageFile)[] };

  store: BehaviorSubject<Observable<() => Promise<OperationEvent>>>;
  bus: Observable<OperationEvent>;

  constructor(
    w3: Object,
    address: Address,
    account?: Address,
    accountPrivateKey?: PrivateKey
  ) {
    this.address = sanitizeAddress(address, { checksum: false });
    this.account = sanitizeAddress(account);
    this.accountPrivateKey = accountPrivateKey;

    this.w3 = w3;
    this.fs = new FileStorage(w3, true);
    this.contract = (this.fs.contract.contract as unknown) as ContractContext;

    this.cache = {};

    this.store = new BehaviorSubject(of(
      () => (Promise.resolve({
        type: "INIT",
        status: "success"
      } as OperationEvent))
    ));

    this.bus = this.store.pipe(
      concatMap(async (taskObserver, index) => {
        // console.log("fm:bus:concatMap::taskObserver", taskObserver, index);

        const task = await firstValueFrom(taskObserver);
        // console.log("fm:bus:concatMap::task", task);

        const returnValue = await task();
        // console.log("fm:bus:concatMap::event:::returnValue", returnValue);

        returnValue.result &&
          returnValue.result.destDirectory &&
          this.purgeCache(returnValue.result.destDirectory);

        return returnValue;
      }),
      share()
    );

    const addrWithoutPrefix = sanitizeAddress(address, {
      checksum: false,
      prefix: false
    });

    this.index = {}

    this.rootDir = new DeDirectory({
      name: addrWithoutPrefix, // do-not-change: heavy dependency
      storagePath: addrWithoutPrefix,
      isFile: false,
    }, this);
  }

  isRootDir(directory: DeDirectory) {
    return directory.path === "";
  }

  indexDirectory(directory: DeDirectory) {
    this.index[directory.path] = directory;
  }

  absolutePath(fileOrDir: FileOrDir): string {

    if (fileOrDir.kind === KIND.FILE) {
      return this.rootDir.name + '/' + fileOrDir.path;
    }
    if (fileOrDir.kind === KIND.DIRECTORY) {
      return this.isRootDir(fileOrDir as DeDirectory)
        ? this.rootDir.name
        : this.rootDir.name + '/' + fileOrDir.path;
    }
    return '';
  }

  private purgeCache(directory?: DeDirectory, reload = true) {
    let path = directory && this.absolutePath(directory);
    if (path) {
      delete this.cache[path];
      this.loadDirectory(path);
    } else {
      this.cache = {};
      this.preloadDirectories(this.rootDir);
    }
    // console.log("filemanager::purgeCache:path", path);
  }

  private async queueOp(
    key: string,
    taskPromise: () => Promise<any>,
    onSuccess?: (res: any) => OperationEvent['result'],
    onError?: (res: any) => OperationEvent['result']
  ): Promise<OperationEvent> {
    const id = nanoid();
    this.store.next(of(() => (
      taskPromise()
        .then((res: any) => {
          return {
            id,
            type: key,
            status: 'success',
            result: onSuccess && onSuccess(res)
          } as OperationEvent
        }).catch((err: any) => {
          return {
            id,
            type: key,
            status: 'error',
            result: onError && onError(err)
          } as OperationEvent
        })
    )));
    return new Promise((resolve, reject) => {
      const subscription = this.bus.subscribe((event: any) => {
        if ((event.id === id)) {
          if (event.status === 'success') {
            subscription.unsubscribe();
            return resolve(event);
          }
          if (event.status === 'error') {
            subscription.unsubscribe();
            return reject(event);
          }
        }
      })
    });
  }

  //@ts-ignore
  async * entriesGenerator(directory: DeDirectory): Promise<Iterable<FileOrDir>> {
    let path = this.absolutePath(directory);

    // hit remote
    const entries = await this.loadDirectory(path);

    // map to iterable files & directories
    for (let i in entries) {
      let item = entries[i];
      // make DeFile
      if (item.isFile) {
        item = <FileStorageFile>item;
        yield new DeFile(item as FileStorageFile, this, directory);
      }
      // recursive: make DeDirectory with entries()
      else {
        yield new DeDirectory(item as FileStorageDirectory, this, directory);
      }
    }
  }

  rootDirectory() {
    return this.rootDir;
  }

  loadAddress(
    address: Address = (this.account || "")
  ) {
    if (address) {
      this.address = sanitizeAddress(address, { checksum: false });
    }
  }

  // @todo: validate correctness
  async accountIsAdmin() {
    if (!this.account)
      return false;
    const ADMIN_ROLE = await this.contract.methods.DEFAULT_ADMIN_ROLE().call();
    return await this.contract.methods.hasRole(ADMIN_ROLE, this.account).call();
  }

  async accountIsAllocator() {
    if (!this.account)
      return false;
    const ALLOCATOR_ROLE = await this.contract.methods.ALLOCATOR_ROLE().call();
    return await this.contract.methods.hasRole(ALLOCATOR_ROLE, this.account).call();
  }

  async reserveSpace(address: Address, amount: number) {
    if (!this.account)
      throw Error(ERROR.NO_ACCOUNT);
    const signer = this.account || "";
    return this.queueOp(
      OPERATION.RESERVE_SPACE,
      () => this.fs.reserveSpace(signer, sanitizeAddress(address), amount, this.accountPrivateKey),
    );
  }

  async grantRole(address: Address, role: string = ROLE.ALLOCATOR) {
    if (!this.account)
      throw Error(ERROR.NO_ACCOUNT);
    const signer = this.account || "";

    if (!(await this.accountIsAdmin())) {
      throw Error(ERROR.NOT_AUTHORIZED);
    }
    if (!role) {
      throw Error(ERROR.UNKNOWN);
    }

    return this.queueOp(
      OPERATION.GRANT_ROLE,
      () => this.fs.grantAllocatorRole(signer, sanitizeAddress(address), this.accountPrivateKey)
    );
  }

  /**
   * Load directory listing by absolute path, supported by cache
   * @param path 
   * @param noCache 
   */
  async loadDirectory(
    path: FileStorageDirectory['storagePath'],
    noCache: boolean = false
  ): Promise<Array<FileStorageFile | FileStorageDirectory>> {
    let entries;
    if (this.cache[path] && !noCache) {
      entries = this.cache[path];
    } else {
      entries = await this.fs.listDirectory(`${path}`);
      this.cache[path] = entries;
    }
    return sortBy(entries, ((o: FileStorageDirectory | FileStorageFile) => o.isFile === true));
  }

  /**
   * Create a directory within destination directory
   * @param destDirectory 
   * @param name 
   */
  async createDirectory(
    destDirectory: DeDirectory,
    name: string
  ): Promise<OperationEvent> {

    if (!this.account)
      throw Error(ERROR.NO_ACCOUNT);
    const signer = this.account || "";

    const path = this.isRootDir(destDirectory) ? name : `${destDirectory.path}/${name}`;

    return this.queueOp(
      OPERATION.CREATE_DIRECTORY,
      () => this.fs.createDirectory(signer, path, this.accountPrivateKey),
      (storagePath) => ({
        destDirectory,
        directory: new DeDirectory({ storagePath, name, isFile: false }, this, destDirectory)
      }),
      (err) => ({
        error: err,
        destDirectory,
        directory: new DeDirectory({
          storagePath: this.absolutePath(destDirectory) + "/" + name,
          name,
          isFile: false
        }, this, destDirectory)
      }),
    );
  }

  /**
   * Delete a file in destination directory
   * @param destDirectory 
   * @param file 
   */
  async deleteFile(
    destDirectory: DeDirectory,
    file: DeFile
  ): Promise<OperationEvent> {

    if (!this.account)
      throw Error(ERROR.NO_ACCOUNT);
    const signer = this.account || "";

    return this.queueOp(
      OPERATION.DELETE_FILE,
      () => this.fs.deleteFile(signer, file.path, this.accountPrivateKey),
      (res) => ({
        destDirectory,
        file
      }),
      (err) => ({
        destDirectory,
        error: err
      })
    )
  }

  /**
   * Delete a directory 
   * @param directory 
   * refactor this if queueing is extended with non-sequential options
   * or when network supports nested deletion
   */
  async deleteDirectory(directory: DeDirectory): Promise<OperationEvent> {
    if (directory.path === this.rootDir.path)
      throw Error(ERROR.UNKNOWN);
    if (!this.account)
      throw Error(ERROR.NO_ACCOUNT);
    const signer = this.account || "";

    let task: Promise<OperationEvent>;

    const op = (directory: DeDirectory) => this.queueOp(
      OPERATION.DELETE_DIRECTORY,
      () => this.fs.deleteDirectory(signer, directory.path, this.accountPrivateKey),
      (res) => ({
        destDirectory: directory.parent,
        directory
      }),
      (err) => ({
        destDirectory: directory.parent,
        error: err
      })
    )

    return new Promise(async (resolve, reject) => {
      let promises: Promise<OperationEvent>[] = [];
      await this.iterateDirectory(directory, (entry) => {
        task = (
          (entry as FileOrDir).kind === "directory" ?
            op(entry as DeDirectory)
            :
            this.deleteFile((entry as FileOrDir).parent as DeDirectory, entry as DeFile)
        );
        promises.push(task);
      });
      Promise.all(promises)
        .then(res => {
          resolve(op(directory))
        });
    });
  }

  /**
   * Upload a file in destination directory using File object
   * @param destDirectory 
   * @param file 
   */
  async uploadFile(
    destDirectory: DeDirectory,
    file: FileLike,
  ): Promise<OperationEvent> {

    if (!this.account)
      throw Error(ERROR.NO_ACCOUNT);
    const signer = this.account || "";

    let buffer: Buffer;

    if (file.buffer) {
      buffer = file.buffer();
    }
    else if (file.arrayBuffer) {
      const arrayBuffer = await file.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    }
    else {
      throw Error(ERROR.UNKNOWN);
    }

    const uploadPath = (destDirectory.path === this.rootDir.path)
      ? file.name
      : `${destDirectory.path}/${file.name}`;

    return this.queueOp(
      OPERATION.UPLOAD_FILE,
      () => this.fs.uploadFile(signer, uploadPath, buffer, this.accountPrivateKey),
      (storagePath) => ({
        destDirectory,
        file: new DeFile({
          storagePath,
          name: file.name,
          isFile: true,
          size: file.size || 0,
          status: 2,
          uploadingProgress: 100
        }, this)
      }),
      (err) => ({
        destDirectory,
        file,
        error: err,
      })
    );
  }

  /**
   * Download a file
   * @param file 
   */
  async downloadFile(file: DeFile) {
    return this.fs.downloadToFile(this.rootDir.name + "/" + file.path);
  }

  /**
   * Iterate a directory by depth and perform list or item operations
   * @param directory 
   * @param onEntry 
   * @param asArray 
   * @param depth 
   */
  private async iterateDirectory(
    directory: DeDirectory,
    onEntry: (entry: FileOrDir | Array<FileOrDir>, stop: () => void) => any,
    asArray: boolean = false,
    depth: number = Infinity
  ): Promise<void> {

    let level = 0;
    let flag = true;

    const stop = () => {
      flag = false;
    }

    // Depth-first
    const iterator = async (
      directory: DeDirectory,
      onEntry: (entry: FileOrDir | Array<FileOrDir>, stop: () => void, level: number) => boolean,
      asArray: boolean = false
    ): Promise<void> => {

      if (flag == false) return;
      let all = [];
      //@ts-ignore
      for await (const entry of directory.entries()) {
        if ((entry.kind === KIND.DIRECTORY) && (level < depth) && (flag === true)) {
          level++;
          await iterator(entry, onEntry);
        }
        (asArray) ? all.push(entry) : onEntry(entry, stop, level);
      }
      if (asArray) {
        onEntry(all, stop, level);
      }
    }

    return iterator(directory, onEntry, asArray);
  }

  async preloadDirectories(startDirectory: DeDirectory) {
    await this.iterateDirectory(
      startDirectory,
      (entry) => { },
    );

    // console.log("filemanager::preloadDirectories: complete");
  }

  /**
   * Resolve DeDirectory or DeFile from relative path
   * @param path relative path
   */
  async resolvePath(path: FileOrDir['path']): Promise<FileOrDir | undefined> {
    if (path === "") {
      return this.rootDir;
    }
    let found: (FileOrDir | undefined) = this.index[path];

    if (found) return found;

    await this.iterateDirectory(this.rootDir, (entry, stop) => {
      if ((entry as FileOrDir).path === path) {
        found = entry as FileOrDir;
        stop();
      }
    });

    return found;
  }

  /**
   * Fuzzy search across the directory tree with a starting node
   * @param inDirectory 
   * @param query 
   */
  async search(inDirectory: DeDirectory, query: string) {

    let results: Array<FileOrDir> = [];

    if (!query) return results;

    const handleList = (list: any) => {
      const fuse = new Fuse(list, { keys: ['name'] });
      const result = fuse.search(query.trim()).map(r => r.item) as FileOrDir[];
      results = [...results, ...result];
    }

    await this.iterateDirectory(inDirectory, handleList, true);
    console.log("filemanager::search:results", results);
    return results;
  }

  /**
   * Get space occupied by the current address
   */
  async occupiedSpace() {
    return (await this.fs.getOccupiedSpace(this.address));
  }

  /**
   * Get space reserved for the current address
   */
  async reservedSpace() {
    return (await this.fs.getReservedSpace(this.address));
  }

  /**
   * Get space reserved on the entire file system
   */
  async totalReservedSpace() {
    return (await this.fs.getTotalReservedSpace());
  }

  /**
   * Get total space available on the file system
   */
  async totalSpace() {
    return (await this.fs.getTotalSpace());
  }
}

export {
  OPERATION,
  DeFileManager,
  DeFile,
  DeDirectory
}