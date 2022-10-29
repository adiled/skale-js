import Web3 from 'web3';

function pathToRelative(storagePath: string) {
  return storagePath.split("/").slice(1).join('/');
}

function pathToAbsolute(path: string, address: string) {
  const home = sanitizeAddress(address, { prefix: false, checksum: false });
  return (path === "")
    ? home
    : home + '/' + path;
}

function sanitizeAddress(
  addressLike: string = "",
  { prefix = true, checksum = true }: { prefix?: boolean, checksum?: boolean } = {}
) {

  const isAddress = Web3.utils.isAddress(addressLike);
  if (!isAddress) {
    return "";
  }

  let address = addressLike;
  const length = addressLike.length;

  if (checksum) {
    address = Web3.utils.toChecksumAddress(address);
  } else {
    address = address.toLowerCase();
  }

  // prefix transform after checksum is important since we want intuitive results vs web3ily-correct

  if (prefix) {
    address = '0x' + address.replace(/^0x/i, '');
  } else {
    address = address.replace(/^0x/i, '');
  }

  return address;
}

export default {
  pathToRelative,
  pathToAbsolute,
  sanitizeAddress
}