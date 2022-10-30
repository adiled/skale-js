export const KIND = {
  FILE: "file",
  DIRECTORY: "directory"
}

export const ROLE = {
  OWNER: 'OWNER',
  ALLOCATOR: 'ALLOCATOR',
  CHAIN_OWNER: 'CHAIN_OWNER'
}

export const OPERATION = {
  UPLOAD_FILE: 'UPLOAD_FILE',
  DELETE_FILE: 'DELETE_FILE',
  DELETE_DIRECTORY: 'DELETE_DIRECTORY',
  CREATE_DIRECTORY: 'CREATE_DIRECTORY',
  GRANT_ROLE: 'GRANT_ROLE',
  RESERVE_SPACE: 'RESERVE_SPACE'
}

// @todo-enhancement: improve error coverage, segment some to state, extend with codes
export const ERROR = {
  NO_ACCOUNT: "File manager has no signer account",
  NOT_AUTHORIZED: "Signer not authorized to perform the operation",
  BUSY: "File system is currently busy",
  UNKNOWN: "Something went wrong",
  NO_NET: "You are currently offline"
}