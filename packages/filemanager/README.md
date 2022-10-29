## DeFileManager

DeFileManager (filemanager.ts) was built on the earliest idea to inherit browser file system spec into decentralized file storage capabilities. The implementation however is lightweight with file and directory used by a file manager interface playing a similar role as [web file system API](https://developer.mozilla.org/en-US/docs/Web/API/FileSystem).

The implementation is on top of `filestorage.js`, and includes its typings within the package.

### Scope

- Uses well-defined typings making data formats consistent and intuitive
- Async iterative traversal of file tree
- Out-of-the-box fuzzy search
- Instantiation with signer (account) and active address
- Caching of file tree and pre-loading
- Special handling and IDing of transactional operations
- Concurrent yet sequential operations for compatibility with transactions
- File path consistency with relative and absolute transforms
- Compact utility functions

### Transactional Operations

Transactional operations are the ones that implicitly initiate on-chain transactions. These are identified with keys in constant `OPERATION`. The DeFileManager allows unimpeded calls on functions. Internally they are sequenced by rules (rxjs definitions), which are presently sequential.

An intuitive way to think of it is as operations on the file storage getting queued instead of immediately initiating, and upon reaching finality, emitting on the subscribable store.

### Key Classes

- `DeFileManager`
- `DeFile`
- `DeDirectory`

### React Hook: useDeFileManager

Maintains state around wallet provider and file manager instances, presently singular.

- Current working directory and up-to-date listing
- Active uploads with progress
- Stateful initiation and completion of transactional operations

### Server-side use

The project deployment script demonstrates use of the library with NodeJS alongside TS.

### Notes on improvement

- Transactional operations could inter-operate with contract events, fs.js events (if implemented), and block events.
- Paths and resolution can be improved with a special class.
- Support for [MTM](https://skale.network/blog/Multi-transaction-mode-aka-speedy-game-mode) may be built into `filestorage.js` and then this package will have to be updated to pipe transactions in packets of max MTM limit by chain.

### Reference

Up-to-date interfaces are best referred to within the [package](https://github.com/skalenetwork/filestorage-ui/tree/main/src/packages/filemanager).