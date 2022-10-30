import { useEffect, useLayoutEffect, useReducer, useRef, useCallback } from 'react';
import { useInterval } from 'react-use';

import type { FileStorageDirectory, FileStorageFile } from '@skalenetwork/filestorage.js';
import { DeFileManager, DeDirectory, DeFile, FileOrDir } from '../filemanager/defilemanager';
import type { FileLike, OperationEvent, DePath } from '../filemanager/types';
import { OPERATION } from '../filemanager/constants';

export type FileStatus = {
  file: File;
  path: FileStorageFile['storagePath'];
  progress: number;
  error?: {
    name: string;
    message: string;
    stack: string;
  };
};

export type MainState = {
  // instantiation on signer+address
  fm: DeFileManager | undefined;

  // signer relative to chain
  accountRoles: [];

  // signer relative to address
  isAuthorized: boolean;

  // current file navigation state
  directory: DeDirectory | undefined;
  listing: Array<FileOrDir>;
  isLoadingDirectory: boolean;

  // address specific
  reservedSpace: number;
  occupiedSpace: number;
}

export type OperationState = {
  // operations on address by signer
  isCreatingDirectory: boolean;
  activeUploads: Map<DePath, Array<FileStatus>>;
  completedUploads: Map<DePath, Array<FileStatus>>;
  failedUploads: Map<DePath, Array<FileStatus>>;
  totalUploadCount: number;
  uploadStatus: number;
}

export type State = MainState & OperationState;

export type Action = {
  createDirectory: (name: string, directory?: DeDirectory) => Promise<void>;
  uploadFiles: (files: Array<File>, directory: DeDirectory) => Promise<void>;
  deleteFile: (file: DeFile, directory: DeDirectory) => Promise<void>;
  deleteDirectory: (directory: DeDirectory) => Promise<void>;
  changeDirectory: (directory: DeDirectory) => unknown;
}

export const ROLE = {
  ALLOCATOR: 'ALLOCATOR',
  ADMIN: 'ADMIN'
}

const initialState: State = {
  isAuthorized: false,
  accountRoles: [],
  fm: undefined,
  directory: undefined,
  listing: [],
  isCreatingDirectory: false,
  isLoadingDirectory: false,
  reservedSpace: 0,
  occupiedSpace: 0,
  totalUploadCount: 0,
  activeUploads: new Map(),
  completedUploads: new Map(),
  failedUploads: new Map(),
  uploadStatus: 0,
};

const ACTION = {
  INITIALIZE: 'INITIALIZE',
  SET_ROLES: 'SET_ROLES',
  SET_AUTHORITY: 'SET_AUTHORITY',
  SET_CAPACITY: 'SET_CAPACITY',

  CHANGE_DIRECTORY: 'CHANGE_DIRECTORY',
  SET_LISTING: 'SET_LISTING',
  SET_DIRECTORY_OP: 'SET_DIRECTORY_OP',
  SET_LOADING_DIRECTORY: 'SET_LOADING_DIRECTORY',

  INIT_UPLOADS: 'INIT_UPLOADS',
  SET_DIRECTORY_UPLOADS: 'SET_DIRECTORY_UPLOADS',
  SET_UPLOAD: 'SET_UPLOAD',
  RESET_UPLOADS: 'RESET_UPLOADS',
  RESET_FAILED_UPLOADS: 'RESET_FAILED_UPLOADS', // @to_deprecate after prune actions
  SET_UPLOADS_PROGRESS: 'SET_UPLOADS_PROGRESS',
};

const reducer = (
  state: State,
  action: { type: string, payload: any }
): State => {
  switch (action.type) {
    case ACTION.SET_ROLES:
      return { ...state, accountRoles: action.payload }
    case ACTION.SET_AUTHORITY:
      return { ...state, isAuthorized: action.payload }
    case ACTION.INITIALIZE:
      return {
        ...initialState,
        fm: action.payload.fm,
        directory: action.payload.directory,
      }
    case ACTION.SET_CAPACITY:
      return {
        ...state,
        ...action.payload
      }

    case ACTION.CHANGE_DIRECTORY:
      return { ...state, directory: action.payload }
    case ACTION.SET_LISTING:
      return { ...state, listing: action.payload }
    case ACTION.SET_DIRECTORY_OP:
      return { ...state, isCreatingDirectory: action.payload }
    case ACTION.SET_LOADING_DIRECTORY:
      return { ...state, isLoadingDirectory: action.payload }

    // 
    case ACTION.INIT_UPLOADS:
      const { uploads, directory }: { directory: DePath, uploads: FileStatus[] } = action.payload;
      const activeUploads = new Map(state.activeUploads);
      const scopeUploads = activeUploads.get(directory) || [];
      activeUploads.set(directory, [...scopeUploads, ...uploads]);
      return {
        ...state,
        activeUploads,
        totalUploadCount: state.totalUploadCount + uploads.length
      }
    case ACTION.SET_UPLOAD:
      {
        let { directory, file }:
          { directory: DePath, file: FileStatus } = action.payload;

        const activeUploads = new Map(state.activeUploads);
        const scopeUploads = [...activeUploads.get(directory) || []];
        const index = scopeUploads.findIndex(f => f.path === file.path);

        if (index < 0) {
          scopeUploads.push(file);
        } else {
          scopeUploads[index] = file;
        }

        activeUploads.set(directory, scopeUploads);

        return {
          ...state,
          activeUploads,
        }
      }
    case ACTION.SET_DIRECTORY_UPLOADS:
      {
        let { directory, uploads }: { directory: DePath, uploads: FileStatus[] } = action.payload;
        const activeUploads = new Map(state.activeUploads);
        activeUploads.set(directory, uploads);
        return {
          ...state,
          activeUploads
        }
      }
    case ACTION.RESET_UPLOADS:
      return {
        ...state,
        totalUploadCount: 0,
        activeUploads: initialState.activeUploads
      }
    case ACTION.RESET_FAILED_UPLOADS:
      return {
        ...state,
        failedUploads: initialState.failedUploads
      }
    case ACTION.SET_UPLOADS_PROGRESS:
      return {
        ...state,
        uploadStatus: action.payload
      }
    default:
      console.log('Unregistered action', action.type);
      return state;
  }
}

export function useDeFileManager(
  w3Provider: any, address: string, privateKey?: string
): [DeFileManager, State, Action] {

  const [state, dispatch]: [State, Function] = useReducer(reducer, initialState);

  const { fm, directory: cwd } = state;

  const updateCapacity = async () => {
    if (!fm) return;
    dispatch({
      type: ACTION.SET_CAPACITY,
      payload: {
        reservedSpace: await fm.reservedSpace(),
        occupiedSpace: await fm.occupiedSpace()
      }
    });
  }

  // assuming isRefresh is used outside effects
  const loadCurrentDirectory = async (isRefresh?: boolean) => {
    let dir = (isRefresh) ? cwdRef.current : cwd;
    if (!dir) return;

    !isRefresh && dispatch({
      type: ACTION.SET_LOADING_DIRECTORY,
      payload: true
    });

    const entries = await dir.entries();
    let listing = [];
    for await (let item of (entries || [])) {
      listing.push(item);
    }
    dispatch({
      type: ACTION.SET_LISTING,
      payload: listing
    });

    !isRefresh && dispatch({
      type: ACTION.SET_LOADING_DIRECTORY,
      payload: false
    });
  };

  const maybeRefreshCwd = async (directory: DeDirectory) => {
    if (!cwdRef.current) return;
    if (directory.path === cwdRef.current.path) {
      loadCurrentDirectory(true);
    }
  };

  // make-shift, integrate to interfaces already! -.-
  const absolutePath = (relativePath: string): FileStorageFile['storagePath'] => {
    if (!fm) return '';
    const absolutePath = fm.rootDirectory().name
      + ((!relativePath || relativePath.slice(0, 1) === '/') ? '' : '/')
      + relativePath;
    return absolutePath;
  }

  const cwdRef = useRef(cwd);

  // horridly frequent and expensive, better not done as side-effect
  // first candidate for improvement after upload actions are better structured
  useEffect(() => {
    const allUploads = Array.from(state.activeUploads.values()).flat() || [];
    const payload = allUploads.length === 0
      ? 0
      : (allUploads.every(upload => (upload.error || (upload.progress === 100))))
        ? 2
        : 1;
    // currently only need for flag
    dispatch({
      type: ACTION.SET_UPLOADS_PROGRESS,
      payload
    });
  }, [state.activeUploads]);

  // initialize root as current directory, roles and authorization
  useLayoutEffect(() => {
    if (!(w3Provider && address)) return;

    let account;
    if (w3Provider.selectedAddress) {
      account = w3Provider.selectedAddress;
    }

    const fm = new DeFileManager(w3Provider, address, account, privateKey);
    fm.bus.subscribe((event: OperationEvent) => {
      console.log("event", event);
      if (event.status === "success" && (event.result && event.result.destDirectory)) {
        maybeRefreshCwd(event.result.destDirectory);
      }
      switch (event.type) {
        case OPERATION.CREATE_DIRECTORY:
          dispatch({
            type: ACTION.SET_DIRECTORY_OP, payload: false
          });
          break;
        case OPERATION.UPLOAD_FILE:
          if (event.status === "error") {
            console.error("uploadFile::failure", event.result.error);
            const { error, destDirectory, file } = event.result;
            dispatch({
              type: ACTION.SET_UPLOAD,
              payload: {
                directory: destDirectory.path,
                file: {
                  file: event.result.file,
                  path: absolutePath(`${destDirectory.path}/${file.name}`),
                  progress: 0,
                  error: error.error
                }
              }
            });
          }
          break;
        case OPERATION.DELETE_FILE:
        case OPERATION.DELETE_DIRECTORY:
          if (event.status === "error") return;
          if (!cwdRef.current) return;
          const { destDirectory, file, directory } = event.result;
          if (destDirectory.path === cwdRef.current.path) {
            let listing = [...state.listing];
            const index = listing.findIndex(item => item.path === (file || directory).path);
            if (!index) return;
            listing.splice(index, 1);
            dispatch({
              type: ACTION.SET_LISTING,
              payload: listing
            });
          }
          break;
        case OPERATION.RESERVE_SPACE:
          break;
        case OPERATION.GRANT_ROLE:
          break;
      }
    })

    dispatch({
      type: ACTION.INITIALIZE, payload: {
        fm,
        directory: fm.rootDirectory()
      }
    });
    dispatch({
      type: ACTION.SET_AUTHORITY,
      payload: ((account || "").toLowerCase() === address.toLowerCase())
    });

    (async () => {
      let roles = [];
      if (await fm.accountIsAllocator()) {
        roles.push(ROLE.ALLOCATOR);
      }
      if (await fm.accountIsAdmin()) {
        roles.push(ROLE.ADMIN);
      }
      if (roles.length) {
        dispatch({
          action: ACTION.SET_ROLES,
          payload: roles
        });
      }
    })();

  }, [w3Provider, address, privateKey]);

  // setup storage metadata
  useLayoutEffect(() => {
    updateCapacity();
    fm?.preloadDirectories(fm.rootDirectory());
  }, [fm]);


  // keep current directory synced to ref
  useEffect(() => {
    cwdRef.current = cwd;
  }, [cwd]);

  // load listing based on current directory
  useLayoutEffect(() => {
    if (!cwd) return;
    dispatch({
      type: ACTION.SET_LISTING,
      payload: []
    });
    loadCurrentDirectory();
  }, [state.fm, cwd]);

  // periodically fetch relevant directory listings, update active uploads with progress
  // tested for uploads under 1mb: file being uploaded not reflected in directory listing via node
  // @todo can be better managed after some restructure involving converging remote + local state vs lookup of remote
  const refreshActiveUploads = useCallback(async () => {
    if (!fm) return;
    for (let dirPath of state.activeUploads.keys()) {
      // no in-progress uploads for directory, skip
      const dirUploads = state.activeUploads.get(dirPath);
      if (!dirUploads?.length || dirUploads.every(upload => (upload.error || upload.progress === 100)))
        continue;

      // get remote listing for directory
      let listing: (FileStorageFile | FileStorageDirectory)[] = await fm.loadDirectory(absolutePath(dirPath), true);

      // uploads mapped to progress from remote listing
      let dirUploadsWithProgress =
        dirUploads.map(upload => {
          if (upload.error || upload.progress === 100) {
            return upload;
          }
          const match = listing.find(f => {
            // console.log("interval:: upload match params", f.storagePath, '===', upload.path);
            return f.storagePath === upload.path
          });
          // console.log("interval::upload match", JSON.stringify(match));
          return { ...upload, progress: (match as FileStorageFile)?.uploadingProgress || 0 }
        });

      dispatch({
        type: ACTION.SET_DIRECTORY_UPLOADS, payload: {
          directory: dirPath,
          uploads: dirUploadsWithProgress
        }
      });
    }
  }, [state.activeUploads, fm]);

  useInterval(refreshActiveUploads, 2000);

  const createDirectory = async (
    name: string,
    directory: DeDirectory = (cwd as DeDirectory)
  ) => {

    if (!(fm && cwd && state.isAuthorized)) {
      throw Error("Not authorized");
    }

    dispatch({
      type: ACTION.SET_DIRECTORY_OP, payload: true
    });
    fm.createDirectory(directory, name);
  }

  const uploadFiles = async (
    files: Array<File>,
    directory: DeDirectory = (cwd as DeDirectory)
  ): Promise<void> => {

    if (!(fm && cwd && state.isAuthorized)) {
      throw Error("Not authorized");
    }

    console.log("uploadFiles", files, directory);

    if (!files.length) {
      console.error("uploadFiles:: No files to upload");
      return;
    }

    // add to the active uploads with zero progress
    dispatch({
      type: ACTION.INIT_UPLOADS,
      payload: {
        directory: directory.path,
        uploads: files.map(file => ({
          file,
          path: absolutePath(`${directory.path}/${file.name}`),
          progress: 0
        } as FileStatus
        ))
      }
    });

    for (let index = 0; index < files.length; index++) {
      let file = files[index];
      fm.uploadFile(directory, file as FileLike);
    };
  };

  const deleteFile = async (
    file: DeFile,
    directory: DeDirectory = (cwd as DeDirectory)
  ) => {
    if (!(fm && cwd && state.isAuthorized)) {
      throw Error("Not authorized");
    }
    fm.deleteFile(directory, file);
  };

  const deleteDirectory = async (
    directory: DeDirectory
  ) => {
    if (!(fm && cwd && state.isAuthorized)) {
      throw Error("Not authorized");
    }
    fm.deleteDirectory(directory);
  };

  const actions: Action = {
    uploadFiles,
    deleteFile,
    createDirectory,
    deleteDirectory,
    changeDirectory: (directory: DeDirectory) => dispatch({
      type: ACTION.CHANGE_DIRECTORY,
      payload: directory
    })
  };

  return [fm as DeFileManager, state, actions];
}