/**
 * Interfacing based on simpified form of web FileSystem and FileSystem Access API
 * we start without file handles
 */

export type FilePath = string;
export type DePath = string;
export type Address = string;
export type PrivateKey = string;

export type OperationPayload = {
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