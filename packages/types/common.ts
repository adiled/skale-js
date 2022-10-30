export type Chain = {
  protocol: string; // http or https
  nodeDomain: string; // node host FQDN
  version: string; // chain version
  sChainName: string; // chain name
  chainId: string; // chain ID
}

export type FilePath = string;